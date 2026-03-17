import type { CollectorSource } from '@prisma/client';
import { BaseCollector } from './base-collector';
import type { CollectedItem, GoogleCalendarConfig } from './types';
import { readFile } from 'fs/promises';

const DRIVE_CREDENTIALS_PATH = process.env.GOOGLE_DRIVE_CREDENTIALS
  || '/home/lazybee/.config/gcloud/drive_credentials.json';

/**
 * Google Calendar Collector
 * OAuth2로 Calendar API 접근, 일정 수집
 *
 * 인증: drive_credentials.json (OAuth2 refresh_token, calendar.readonly scope)
 * 기본: primary 캘린더, 앞뒤 30일 범위
 */
export class CalendarCollector extends BaseCollector {
  readonly type = 'GOOGLE_CALENDAR' as const;

  private accessToken: string | null = null;

  validate(config: unknown): boolean {
    // 모든 필드 optional이므로 config가 객체이기만 하면 유효
    return typeof config === 'object' && config !== null;
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
    const config = source.config as unknown as GoogleCalendarConfig;
    const calendarId = config?.calendarId || 'primary';
    const daysBack = config?.daysBack ?? 30;
    const daysForward = config?.daysForward ?? 30;

    const token = await this.getAccessToken();

    const now = new Date();
    const timeMin = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(now.getTime() + daysForward * 24 * 60 * 60 * 1000).toISOString();

    const params = new URLSearchParams({
      timeMin,
      timeMax,
      maxResults: '100',
      singleEvents: 'true',
      orderBy: 'startTime',
    });

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
    const res = await this.fetchWithRetry(url, {
      headers: this.authHeaders(token),
    });
    const data = await res.json() as CalendarEventsResponse;

    if (!data.items || data.items.length === 0) {
      return [];
    }

    const items: CollectedItem[] = [];

    for (const event of data.items) {
      if (!event.id || event.status === 'cancelled') continue;

      const start = this.formatEventTime(event.start);
      const end = this.formatEventTime(event.end);
      const location = event.location || '';
      const attendees = (event.attendees || [])
        .map(a => a.displayName || a.email)
        .filter(Boolean)
        .join(', ');
      const description = event.description || '';

      const contentParts = [`일시: ${start} ~ ${end}`];
      if (location) contentParts.push(`장소: ${location}`);
      if (attendees) contentParts.push(`참석자: ${attendees}`);
      if (description) contentParts.push('', description);

      const content = contentParts.join('\n');
      const startDate = this.parseEventTime(event.start);

      items.push({
        externalId: event.id,
        title: event.summary || '(제목 없음)',
        content,
        metadata: {
          calendarId,
          location: location || undefined,
          attendees: (event.attendees || []).map(a => ({
            email: a.email,
            displayName: a.displayName,
            responseStatus: a.responseStatus,
          })),
          status: event.status,
          htmlLink: event.htmlLink,
        },
        publishedAt: startDate,
      });
    }

    return items;
  }

  private formatEventTime(time: CalendarEventTime | undefined): string {
    if (!time) return '(시간 미정)';
    if (time.dateTime) {
      return new Date(time.dateTime).toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: time.timeZone || undefined,
      });
    }
    if (time.date) {
      return time.date; // 종일 일정
    }
    return '(시간 미정)';
  }

  private parseEventTime(time: CalendarEventTime | undefined): Date | undefined {
    if (!time) return undefined;
    if (time.dateTime) return new Date(time.dateTime);
    if (time.date) return new Date(time.date);
    return undefined;
  }
}

// Calendar API 응답 타입
interface CalendarEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface CalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: CalendarEventTime;
  end?: CalendarEventTime;
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }>;
}

interface CalendarEventsResponse {
  items?: CalendarEvent[];
}
