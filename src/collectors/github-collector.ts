import type { CollectorSource } from '@prisma/client';
import { BaseCollector } from './base-collector';
import type { CollectedItem, GitHubRepoConfig } from './types';
import { sleep } from '@/lib/ai-core';

export class GitHubCollector extends BaseCollector {
  readonly type = 'GITHUB_REPO' as const;

  validate(config: unknown): boolean {
    const c = config as GitHubRepoConfig;
    return !!c?.owner && !!c?.repo;
  }

  protected async doCollect(source: CollectorSource): Promise<CollectedItem[]> {
    const config = source.config as unknown as GitHubRepoConfig;
    if (!config?.owner || !config?.repo) throw new Error('owner and repo are required');

    const token = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const items: CollectedItem[] = [];
    const branch = config.branch || 'main';
    const paths = config.paths || ['README.md', 'docs'];

    // 지정된 경로의 파일 수집
    for (const path of paths) {
      await this.collectPath(config.owner, config.repo, branch, path, headers, items);
      await sleep(500);
    }

    // 이슈 수집 (옵션)
    if (config.includeIssues) {
      await this.collectIssues(config.owner, config.repo, headers, items);
    }

    return items;
  }

  private async collectPath(
    owner: string,
    repo: string,
    branch: string,
    path: string,
    headers: Record<string, string>,
    items: CollectedItem[]
  ): Promise<void> {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;

    try {
      const response = await this.fetchWithRetry(apiUrl, { headers });
      const data = await response.json();

      if (Array.isArray(data)) {
        // 디렉토리
        for (const file of data) {
          if (file.type === 'file' && isTextFile(file.name)) {
            await this.collectFile(owner, repo, file, headers, items);
            await sleep(300);
          }
        }
      } else if (data.type === 'file') {
        await this.collectFile(owner, repo, data, headers, items);
      }
    } catch (error) {
      console.warn(`[GitHub] Failed to collect ${path}:`, error);
    }
  }

  private async collectFile(
    owner: string,
    repo: string,
    file: { name: string; path: string; sha: string; download_url: string },
    headers: Record<string, string>,
    items: CollectedItem[]
  ): Promise<void> {
    try {
      const response = await this.fetchWithRetry(file.download_url, { headers });
      const content = await response.text();

      if (content.length < 10) return;

      items.push({
        externalId: `${owner}/${repo}/${file.path}@${file.sha.slice(0, 7)}`,
        url: `https://github.com/${owner}/${repo}/blob/main/${file.path}`,
        title: `${repo}/${file.path}`,
        content,
        metadata: {
          owner,
          repo,
          filePath: file.path,
          sha: file.sha,
        },
      });
    } catch (error) {
      console.warn(`[GitHub] Failed to download ${file.path}:`, error);
    }
  }

  private async collectIssues(
    owner: string,
    repo: string,
    headers: Record<string, string>,
    items: CollectedItem[]
  ): Promise<void> {
    try {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=30&sort=updated`;
      const response = await this.fetchWithRetry(apiUrl, { headers });
      const issues = await response.json();

      for (const issue of issues) {
        if (issue.pull_request) continue; // PR 제외

        const content = [
          `# ${issue.title}`,
          '',
          issue.body || '',
          '',
          `Labels: ${issue.labels?.map((l: { name: string }) => l.name).join(', ') || 'none'}`,
          `State: ${issue.state}`,
        ].join('\n');

        items.push({
          externalId: `issue-${issue.number}`,
          url: issue.html_url,
          title: `[Issue #${issue.number}] ${issue.title}`,
          content,
          metadata: {
            issueNumber: issue.number,
            state: issue.state,
            labels: issue.labels?.map((l: { name: string }) => l.name),
            author: issue.user?.login,
          },
          publishedAt: new Date(issue.created_at),
        });
      }
    } catch (error) {
      console.warn(`[GitHub] Failed to collect issues:`, error);
    }
  }
}

function isTextFile(name: string): boolean {
  const textExtensions = ['.md', '.txt', '.rst', '.adoc', '.mdx', '.json', '.yaml', '.yml', '.toml'];
  return textExtensions.some((ext) => name.toLowerCase().endsWith(ext));
}
