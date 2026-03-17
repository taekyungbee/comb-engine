import type { CollectorSource } from '@prisma/client';
import { BaseCollector } from './base-collector';
import type { CollectedItem, GoogleWorkspaceConfig } from './types';
import { createHash } from 'crypto';
import { readFile, writeFile, mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const DRIVE_CREDENTIALS_PATH = process.env.GOOGLE_DRIVE_CREDENTIALS
  || '/home/lazybee/.config/gcloud/drive_credentials.json';

/**
 * Google Workspace Collector
 * OAuth2로 Google Drive API 접근, Docs/Sheets/Slides를 export하여 수집
 *
 * 인증: drive_credentials.json (OAuth2 refresh_token)
 * fileType별 export:
 *   - document → text/plain (텍스트 추출)
 *   - spreadsheet → text/csv (CSV 변환)
 *   - presentation → application/pdf → pdf-parse (텍스트 추출)
 */
export class GoogleWorkspaceCollector extends BaseCollector {
  readonly type = 'GOOGLE_WORKSPACE' as const;

  private accessToken: string | null = null;

  validate(config: unknown): boolean {
    const c = config as GoogleWorkspaceConfig;
    return !!c?.fileId && !!c?.fileType;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;

    const raw = await readFile(DRIVE_CREDENTIALS_PATH, 'utf-8');
    const creds = JSON.parse(raw);

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        refresh_token: creds.refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google OAuth 토큰 발급 실패: ${res.status} ${err}`);
    }

    const data = await res.json();
    this.accessToken = data.access_token;
    return this.accessToken!;
  }

  private authHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  protected async doCollect(source: CollectorSource): Promise<CollectedItem[]> {
    const config = source.config as unknown as GoogleWorkspaceConfig;
    if (!config?.fileId) throw new Error('fileId is required');

    const token = await this.getAccessToken();
    const items: CollectedItem[] = [];
    const fileType = config.fileType || 'document';

    const meta = await this.getFileMetadata(config.fileId, token);
    const title = meta.name || config.fileId;

    let content: string;

    switch (fileType) {
      case 'document':
        content = await this.exportAsText(config.fileId, token);
        break;
      case 'spreadsheet':
        content = await this.exportAsCsv(config.fileId, token);
        break;
      case 'presentation':
        content = await this.exportAsPdfText(config.fileId, token);
        break;
      default:
        throw new Error(`Unsupported Google Workspace file type: ${fileType}`);
    }

    if (content.trim().length > 10) {
      items.push({
        externalId: createHash('md5').update(config.fileId).digest('hex'),
        url: `https://docs.google.com/${fileType === 'document' ? 'document' : fileType === 'spreadsheet' ? 'spreadsheets' : 'presentation'}/d/${config.fileId}`,
        title,
        content,
        metadata: {
          fileId: config.fileId,
          fileType,
          mimeType: meta.mimeType,
        },
      });
    }

    return items;
  }

  private async getFileMetadata(fileId: string, token: string): Promise<{ name: string; mimeType: string }> {
    const res = await this.fetchWithRetry(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType`,
      { headers: this.authHeaders(token) },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Drive 메타데이터 조회 실패: ${res.status} ${err}`);
    }
    return res.json();
  }

  private async exportAsText(fileId: string, token: string): Promise<string> {
    const res = await this.fetchWithRetry(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
      { headers: this.authHeaders(token) },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Docs export 실패: ${res.status} ${err}`);
    }
    return res.text();
  }

  private async exportAsCsv(fileId: string, token: string): Promise<string> {
    const res = await this.fetchWithRetry(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`,
      { headers: this.authHeaders(token) },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Sheets export 실패: ${res.status} ${err}`);
    }
    return res.text();
  }

  private async exportAsPdfText(fileId: string, token: string): Promise<string> {
    const res = await this.fetchWithRetry(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`,
      { headers: this.authHeaders(token) },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Slides export 실패: ${res.status} ${err}`);
    }

    const tmpDir = await mkdtemp(join(tmpdir(), 'rag-gws-'));
    try {
      const buffer = Buffer.from(await res.arrayBuffer());
      const pdfParse = (await import('pdf-parse')).default;
      const data = await pdfParse(buffer);
      return data.text;
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}
