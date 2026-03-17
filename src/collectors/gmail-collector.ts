import type { CollectorSource } from '@prisma/client';
import { BaseCollector } from './base-collector';
import type { CollectedItem, GmailConfig } from './types';
import { readFile } from 'fs/promises';

const DRIVE_CREDENTIALS_PATH = process.env.GOOGLE_DRIVE_CREDENTIALS
  || '/home/lazybee/.config/gcloud/drive_credentials.json';

/**
 * Gmail Collector
 * OAuth2로 Gmail API 접근, 검색 쿼리 기반 이메일 수집
 *
 * 인증: drive_credentials.json (OAuth2 refresh_token, gmail.readonly scope)
 * 검색: Gmail 검색 쿼리 문법 (from:, label:, newer_than: 등)
 */
export class GmailCollector extends BaseCollector {
  readonly type = 'GMAIL' as const;

  private accessToken: string | null = null;

  validate(config: unknown): boolean {
    const c = config as GmailConfig;
    return !!c?.query;
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
    const config = source.config as unknown as GmailConfig;
    if (!config?.query) throw new Error('query is required');

    const token = await this.getAccessToken();
    const maxResults = config.maxResults ?? 20;

    // 메시지 목록 조회
    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(config.query)}&maxResults=${maxResults}`;
    const listRes = await this.fetchWithRetry(listUrl, {
      headers: this.authHeaders(token),
    });
    const listData = await listRes.json() as {
      messages?: Array<{ id: string; threadId: string }>;
    };

    if (!listData.messages || listData.messages.length === 0) {
      return [];
    }

    const items: CollectedItem[] = [];

    for (const msg of listData.messages) {
      try {
        const item = await this.fetchMessage(msg.id, token);
        if (item) items.push(item);
      } catch (error) {
        console.error(`[GMAIL] Failed to fetch message ${msg.id}:`, error);
      }
    }

    return items;
  }

  private async fetchMessage(messageId: string, token: string): Promise<CollectedItem | null> {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
    const res = await this.fetchWithRetry(url, {
      headers: this.authHeaders(token),
    });
    const data = await res.json() as GmailMessage;

    const headers = data.payload?.headers || [];
    const subject = this.getHeader(headers, 'Subject') || '(제목 없음)';
    const from = this.getHeader(headers, 'From') || '';
    const to = this.getHeader(headers, 'To') || '';
    const date = this.getHeader(headers, 'Date') || '';
    const labels = data.labelIds || [];
    const threadId = data.threadId || '';

    const body = this.extractBody(data.payload);
    if (!body.trim()) return null;

    const content = `From: ${from}\nTo: ${to}\nDate: ${date}\n\n${body}`;

    return {
      externalId: messageId,
      title: subject,
      content,
      metadata: { from, to, date, labels, threadId },
      publishedAt: date ? new Date(date) : undefined,
    };
  }

  private getHeader(headers: Array<{ name: string; value: string }>, name: string): string | undefined {
    return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;
  }

  private extractBody(payload: GmailPayload | undefined): string {
    if (!payload) return '';

    // text/plain 우선
    const plainText = this.findPart(payload, 'text/plain');
    if (plainText) return plainText;

    // text/html 폴백 (태그 제거)
    const htmlText = this.findPart(payload, 'text/html');
    if (htmlText) return this.stripHtml(htmlText);

    return '';
  }

  private findPart(payload: GmailPayload, mimeType: string): string | null {
    // 단일 파트
    if (payload.mimeType === mimeType && payload.body?.data) {
      return this.decodeBase64Url(payload.body.data);
    }

    // 멀티파트
    if (payload.parts) {
      for (const part of payload.parts) {
        const result = this.findPart(part, mimeType);
        if (result) return result;
      }
    }

    return null;
  }

  private decodeBase64Url(data: string): string {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

// Gmail API 응답 타입
interface GmailPayload {
  mimeType: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  payload?: GmailPayload;
}
