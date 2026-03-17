import type { CollectorSource } from '@prisma/client';
import { BaseCollector } from './base-collector';
import type { CollectedItem } from './types';
import { readFile, readdir, mkdtemp, rm, stat } from 'fs/promises';
import { join, extname, relative } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { createHash } from 'crypto';

const execFileAsync = promisify(execFile);

export interface GitCloneConfig {
  gitUrl: string;
  branch?: string;
  paths?: string[];
  extensions?: string[];
  maxFileSize?: number;
  includeTests?: boolean;
}

const DEFAULT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.kt', '.go', '.rs',
  '.md', '.mdx', '.txt', '.yaml', '.yml', '.toml', '.json',
  '.sql', '.graphql', '.proto', '.html', '.css', '.scss',
  '.sh', '.dockerfile',
];

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', 'vendor', 'target', '.gradle', '.idea', '.vscode',
  'coverage', '.nyc_output', '.turbo', '.cache',
]);

const SKIP_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'composer.lock', 'Gemfile.lock', 'Cargo.lock', 'poetry.lock',
]);

const MAX_FILE_SIZE = 100 * 1024; // 100KB

export class GitCloneCollector extends BaseCollector {
  readonly type = 'GIT_CLONE' as const;

  validate(config: unknown): boolean {
    const c = config as GitCloneConfig;
    return !!c?.gitUrl;
  }

  protected async doCollect(source: CollectorSource): Promise<CollectedItem[]> {
    const config = source.config as unknown as GitCloneConfig;
    if (!config?.gitUrl) throw new Error('gitUrl is required');

    const tmpDir = await mkdtemp(join(tmpdir(), 'rag-git-'));
    const items: CollectedItem[] = [];

    try {
      // git clone (shallow)
      const cloneArgs = ['clone', '--depth', '1'];
      if (config.branch) {
        cloneArgs.push('--branch', config.branch);
      }
      cloneArgs.push(config.gitUrl, tmpDir);

      console.log(`[GitClone] Cloning ${config.gitUrl}...`);
      await execFileAsync('git', cloneArgs, { timeout: 300_000 });

      // 파일 수집
      const extensions = config.extensions || DEFAULT_EXTENSIONS;
      const maxSize = config.maxFileSize || MAX_FILE_SIZE;
      const searchPaths = config.paths || [''];

      for (const searchPath of searchPaths) {
        const fullPath = join(tmpDir, searchPath);
        await this.walkDir(fullPath, tmpDir, extensions, maxSize, config, items);
      }

      console.log(`[GitClone] 수집 완료: ${items.length}개 파일`);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }

    return items;
  }

  private async walkDir(
    dir: string,
    rootDir: string,
    extensions: string[],
    maxSize: number,
    config: GitCloneConfig,
    items: CollectedItem[],
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await this.walkDir(fullPath, rootDir, extensions, maxSize, config, items);
        continue;
      }

      if (!entry.isFile()) continue;
      if (SKIP_FILES.has(entry.name)) continue;

      const ext = extname(entry.name).toLowerCase();
      if (!extensions.includes(ext) && entry.name.toLowerCase() !== 'dockerfile') continue;

      // 테스트 파일 필터
      if (!config.includeTests) {
        const lower = entry.name.toLowerCase();
        if (lower.includes('.test.') || lower.includes('.spec.') || lower.includes('_test.')) continue;
      }

      // 파일 크기 체크
      const fileStat = await stat(fullPath);
      if (fileStat.size > maxSize || fileStat.size < 10) continue;

      try {
        const content = await readFile(fullPath, 'utf-8');

        // DTO/VO 등 단순 클래스 필터링: 로직 없는 파일 (getter/setter만)
        if (this.isBoilerplateFile(content, ext)) continue;

        const relPath = relative(rootDir, fullPath);
        const repoName = this.extractRepoName(config.gitUrl);

        items.push({
          externalId: createHash('md5').update(relPath).digest('hex'),
          url: this.buildFileUrl(config.gitUrl, relPath, config.branch),
          title: `${repoName}/${relPath}`,
          content,
          metadata: {
            gitUrl: config.gitUrl,
            filePath: relPath,
            extension: ext,
            size: fileStat.size,
          },
          tags: [repoName, ext.replace('.', '')],
        });
      } catch {
        // binary file 등 읽기 실패 무시
      }
    }
  }

  private isBoilerplateFile(content: string, ext: string): boolean {
    if (!['.java', '.kt', '.ts', '.js'].includes(ext)) return false;

    const lines = content.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('import') && !l.trim().startsWith('package'));
    if (lines.length < 5) return true;

    // getter/setter/constructor만 있는 DTO 감지
    const methodLines = lines.filter((l) =>
      l.includes('get') || l.includes('set') || l.includes('return this.') || l.includes('this.') || l.includes('constructor'),
    );
    return methodLines.length > lines.length * 0.7;
  }

  private extractRepoName(gitUrl: string): string {
    const match = gitUrl.match(/\/([^/]+?)(\.git)?$/);
    return match?.[1] || 'repo';
  }

  private buildFileUrl(gitUrl: string, filePath: string, branch?: string): string {
    const ref = branch || 'main';
    // GitHub/Gitea URL 변환
    if (gitUrl.includes('github.com') || gitUrl.includes('gitea')) {
      const base = gitUrl.replace(/\.git$/, '');
      return `${base}/blob/${ref}/${filePath}`;
    }
    return `${gitUrl}#${filePath}`;
  }
}
