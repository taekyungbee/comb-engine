import type { CollectorSource } from '@prisma/client';
import { BaseCollector } from './base-collector';
import type { CollectedItem, DocumentFileConfig } from './types';
import { readFile, mkdtemp, rm, readdir } from 'fs/promises';
import { basename, join, extname } from 'path';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { existsSync } from 'fs';

const execFileAsync = promisify(execFile);

const PRESENTATION_EXTENSIONS = new Set(['pptx', 'ppt', 'odp']);

const OFFICE_EXTENSIONS = new Set([
  'pptx', 'ppt', 'xlsx', 'xls', 'docx', 'doc',
  'odp', 'ods', 'odt', 'rtf', 'csv',
]);

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-3.1-flash-lite-preview';

export class DocumentCollector extends BaseCollector {
  readonly type = 'DOCUMENT_FILE' as const;

  validate(config: unknown): boolean {
    const c = config as DocumentFileConfig;
    return !!c?.filePath && !!c?.fileType;
  }

  protected async doCollect(source: CollectorSource): Promise<CollectedItem[]> {
    const config = source.config as unknown as DocumentFileConfig;
    if (!config?.filePath) throw new Error('filePath is required');

    const fileType = config.fileType || 'txt';
    const fileName = basename(config.filePath);

    // PPT 멀티모달: 슬라이드별 이미지 → Gemini Vision 분석
    if (PRESENTATION_EXTENSIONS.has(fileType) && GEMINI_API_KEY) {
      return this.collectPresentationMultimodal(config.filePath, fileName, fileType);
    }

    const items: CollectedItem[] = [];
    let content: string;

    if (OFFICE_EXTENSIONS.has(fileType)) {
      content = await this.convertWithLibreOffice(config.filePath);
    } else {
      switch (fileType) {
        case 'pdf':
          content = await this.parsePdf(config.filePath);
          break;
        case 'md':
        case 'txt':
          content = await readFile(config.filePath, 'utf-8');
          break;
        default:
          throw new Error(`Unsupported file type: ${fileType}`);
      }
    }

    if (content.trim().length > 10) {
      items.push({
        externalId: createHash('md5').update(config.filePath).digest('hex'),
        url: `file://${config.filePath}`,
        title: fileName,
        content,
        metadata: {
          filePath: config.filePath,
          fileType,
        },
      });
    }

    return items;
  }

  /**
   * PPT 멀티모달 수집: 슬라이드별 이미지 변환 → Gemini Vision 분석/요약
   * 화면설계서의 레이아웃, 테이블, 다이어그램을 제대로 추출
   */
  private async collectPresentationMultimodal(
    filePath: string,
    fileName: string,
    fileType: string,
  ): Promise<CollectedItem[]> {
    const tmpDir = await mkdtemp(join(tmpdir(), 'rag-ppt-'));
    const items: CollectedItem[] = [];

    try {
      // PPT → 슬라이드별 PNG 이미지 변환
      await execFileAsync('libreoffice', [
        '--headless',
        '--convert-to', 'png',
        '--outdir', tmpDir,
        filePath,
      ], { timeout: 300_000 });

      // 단일 이미지 변환 시 → 멀티페이지 PDF → 개별 이미지로 분할
      const pngFiles = (await readdir(tmpDir))
        .filter((f) => f.endsWith('.png'))
        .sort();

      if (pngFiles.length === 0) {
        // LibreOffice가 단일 PNG만 생성한 경우 → PDF 경유 분할
        const slideImages = await this.convertToSlideImages(filePath, tmpDir);
        if (slideImages.length === 0) {
          // 폴백: 텍스트 추출
          const textContent = await this.convertWithLibreOffice(filePath);
          if (textContent.trim().length > 10) {
            items.push({
              externalId: createHash('md5').update(filePath).digest('hex'),
              url: `file://${filePath}`,
              title: fileName,
              content: textContent,
              metadata: { filePath, fileType, extractionMethod: 'text-fallback' },
            });
          }
          return items;
        }

        for (let i = 0; i < slideImages.length; i++) {
          const analysis = await this.analyzeSlideImage(slideImages[i], i + 1, fileName);
          if (analysis && analysis.trim().length > 10) {
            items.push({
              externalId: createHash('md5').update(`${filePath}:slide-${i + 1}`).digest('hex'),
              url: `file://${filePath}#slide-${i + 1}`,
              title: `${fileName} - 슬라이드 ${i + 1}`,
              content: analysis,
              metadata: {
                filePath,
                fileType,
                slideIndex: i + 1,
                totalSlides: slideImages.length,
                extractionMethod: 'multimodal',
              },
              tags: ['presentation', 'slide'],
            });
          }
        }
      } else {
        // 슬라이드별 PNG 파일이 생성된 경우
        for (let i = 0; i < pngFiles.length; i++) {
          const imagePath = join(tmpDir, pngFiles[i]);
          const analysis = await this.analyzeSlideImage(imagePath, i + 1, fileName);
          if (analysis && analysis.trim().length > 10) {
            items.push({
              externalId: createHash('md5').update(`${filePath}:slide-${i + 1}`).digest('hex'),
              url: `file://${filePath}#slide-${i + 1}`,
              title: `${fileName} - 슬라이드 ${i + 1}`,
              content: analysis,
              metadata: {
                filePath,
                fileType,
                slideIndex: i + 1,
                totalSlides: pngFiles.length,
                extractionMethod: 'multimodal',
              },
              tags: ['presentation', 'slide'],
            });
          }
        }
      }

      console.log(`[Document] PPT 멀티모달 수집: ${items.length}개 슬라이드 (${fileName})`);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }

    return items;
  }

  /**
   * PPT → PDF → 페이지별 PNG 분할
   */
  private async convertToSlideImages(filePath: string, tmpDir: string): Promise<string[]> {
    // PPT → PDF
    await execFileAsync('libreoffice', [
      '--headless',
      '--convert-to', 'pdf',
      '--outdir', tmpDir,
      filePath,
    ], { timeout: 120_000 });

    const baseName = basename(filePath, extname(filePath));
    const pdfPath = join(tmpDir, `${baseName}.pdf`);
    if (!existsSync(pdfPath)) return [];

    // PDF → 페이지별 PNG (pdftoppm 사용)
    try {
      await execFileAsync('pdftoppm', [
        '-png', '-r', '200',
        pdfPath,
        join(tmpDir, 'slide'),
      ], { timeout: 300_000 });
    } catch {
      // pdftoppm 없으면 convert 시도
      try {
        await execFileAsync('convert', [
          '-density', '200',
          pdfPath,
          join(tmpDir, 'slide-%03d.png'),
        ], { timeout: 300_000 });
      } catch {
        return [];
      }
    }

    const files = await readdir(tmpDir);
    return files
      .filter((f) => f.startsWith('slide') && f.endsWith('.png'))
      .sort()
      .map((f) => join(tmpDir, f));
  }

  /**
   * Gemini Vision으로 슬라이드 이미지 분석
   */
  private async analyzeSlideImage(
    imagePath: string,
    slideNumber: number,
    fileName: string,
  ): Promise<string | null> {
    try {
      const imageBytes = await readFile(imagePath);
      const base64 = imageBytes.toString('base64');
      const ext = extname(imagePath).slice(1).toLowerCase();
      const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64,
                  },
                },
                {
                  text: `이 슬라이드(${fileName}, ${slideNumber}번째)를 분석해주세요.

다음 정보를 추출해주세요:
1. 슬라이드 제목
2. 주요 내용 (텍스트, 목록, 설명)
3. 테이블이 있으면 마크다운 테이블로 변환
4. 다이어그램/플로우차트가 있으면 구조를 텍스트로 설명
5. UI 화면설계서면 레이아웃, 컴포넌트, 인터랙션 설명

빈 슬라이드거나 내용이 거의 없으면 "EMPTY_SLIDE"라고만 답해주세요.
한국어로 답변하되, 기술 용어는 원문 유지.`,
                },
              ],
            }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 2048,
            },
          }),
        },
      );

      if (!res.ok) {
        console.warn(`[Document] Gemini Vision 에러 (slide ${slideNumber}): ${res.status}`);
        return null;
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text || text.includes('EMPTY_SLIDE')) return null;
      return `## 슬라이드 ${slideNumber}\n\n${text}`;
    } catch (error) {
      console.warn(`[Document] 슬라이드 ${slideNumber} 분석 실패:`, error);
      return null;
    }
  }

  private async parsePdf(filePath: string): Promise<string> {
    const pdfParse = (await import('pdf-parse')).default;
    const buffer = await readFile(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }

  /**
   * LibreOffice로 Office 파일 → PDF 변환 → 텍스트 추출
   */
  private async convertWithLibreOffice(filePath: string): Promise<string> {
    const tmpDir = await mkdtemp(join(tmpdir(), 'rag-doc-'));

    try {
      await execFileAsync('libreoffice', [
        '--headless',
        '--convert-to', 'pdf',
        '--outdir', tmpDir,
        filePath,
      ], { timeout: 120_000 });

      const baseName = basename(filePath, extname(filePath));
      const pdfPath = join(tmpDir, `${baseName}.pdf`);

      if (!existsSync(pdfPath)) {
        throw new Error(`LibreOffice 변환 실패: ${filePath}`);
      }

      return await this.parsePdf(pdfPath);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}
