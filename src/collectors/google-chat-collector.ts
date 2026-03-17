import type { CollectorSource } from '@prisma/client';
import { BaseCollector } from './base-collector';
import type { CollectedItem, GoogleChatConfig } from './types';
import { readFile } from 'fs/promises';

const DRIVE_CREDENTIALS_PATH = process.env.GOOGLE_DRIVE_CREDENTIALS
  || '/home/lazybee/.config/gcloud/drive_credentials.json';

/**
 * Google Chat Collector
 * OAuth2로 Google Chat API 접근, 스페이스별 메시지 수집
 * 개발 관련 내용만 필터링
 */
export class GoogleChatCollector extends BaseCollector {
  readonly type = 'GOOGLE_CHAT' as const;

  private accessToken: string | null = null;

  validate(config: unknown): boolean {
    const c = config as GoogleChatConfig;
    return !!c?.spaceId;
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

  protected async doCollect(source: CollectorSource): Promise<CollectedItem[]> {
    const config = source.config as unknown as GoogleChatConfig;
    if (!config?.spaceId) throw new Error('spaceId is required');

    const token = await this.getAccessToken();
    const items: CollectedItem[] = [];
    const maxResults = config.maxResults ?? 100;
    const daysBack = config.daysBack ?? 7;

    const since = new Date();
    since.setDate(since.getDate() - daysBack);

    // 메시지 목록 조회
    const messages = await this.fetchMessages(config.spaceId, token, maxResults);

    for (const msg of messages) {
      const createTime = new Date(msg.createTime);
      if (createTime < since) continue;

      const text = msg.text || '';
      if (text.length < 10) continue;

      // 개발 관련 키워드 필터
      if (!this.isDevRelated(text)) continue;

      const sender = msg.sender?.displayName || msg.sender?.name || '알 수 없음';
      const threadId = msg.thread?.name?.split('/').pop() || '';

      items.push({
        externalId: msg.name,
        url: msg.space?.spaceUri || undefined,
        title: `[Chat] ${sender}: ${text.slice(0, 80)}`,
        content: `발신: ${sender}\n시간: ${createTime.toISOString()}\n스페이스: ${config.spaceId}\n\n${text}`,
        metadata: {
          sender,
          spaceId: config.spaceId,
          threadId,
          messageName: msg.name,
        },
        publishedAt: createTime,
      });
    }

    return items;
  }

  private async fetchMessages(
    spaceId: string,
    token: string,
    maxResults: number,
  ): Promise<ChatMessage[]> {
    const allMessages: ChatMessage[] = [];
    let pageToken: string | undefined;

    while (allMessages.length < maxResults) {
      const pageSize = Math.min(maxResults - allMessages.length, 100);
      let url = `https://chat.googleapis.com/v1/spaces/${spaceId}/messages?pageSize=${pageSize}&orderBy=createTime desc`;
      if (pageToken) url += `&pageToken=${pageToken}`;

      const res = await this.fetchWithRetry(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Google Chat 메시지 조회 실패: ${res.status} ${err}`);
      }

      const data = await res.json();
      const messages = data.messages || [];
      allMessages.push(...messages);

      pageToken = data.nextPageToken;
      if (!pageToken || messages.length === 0) break;
    }

    return allMessages;
  }

  private isDevRelated(text: string): boolean {
    const devKeywords = [
      // 코드/개발
      'bug', 'fix', 'error', 'deploy', 'release', 'commit', 'merge', 'PR',
      'pull request', 'branch', 'git', 'build', 'test', 'debug',
      // 한국어
      '버그', '수정', '에러', '배포', '릴리즈', '커밋', '머지', '브랜치',
      '빌드', '테스트', '디버그', '개발', '구현', '리팩토링', '마이그레이션',
      '스키마', '쿼리', 'API', 'DB', '서버', '클라이언트', '프론트', '백엔드',
      // 기술 용어
      'docker', 'k8s', 'kubernetes', 'nginx', 'redis', 'postgres',
      'spring', 'react', 'next', 'node', 'python', 'java', 'typescript',
      '설계', '아키텍처', '인프라', '모니터링', '로그', '장애', '이슈',
      'jira', 'linear', 'ticket', '티켓', '스프린트', 'sprint',
      // OpenClaw/프로젝트
      'openclaw', 'rag', 'collector', 'embedding', '임베딩', 'MLX', 'gemini',
      'ollama', '크론', 'cron', 'batch', '배치',
    ];

    const lower = text.toLowerCase();
    return devKeywords.some((kw) => lower.includes(kw.toLowerCase()));
  }
}

interface ChatMessage {
  name: string;
  text?: string;
  sender?: { displayName?: string; name?: string };
  createTime: string;
  thread?: { name?: string };
  space?: { spaceUri?: string };
}
