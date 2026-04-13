import type { CollectorSource } from '@prisma/client';
import { BaseCollector } from './base-collector';
import type { CollectedItem, YouTubeChannelConfig } from './types';
import { translateAndSummarize } from '@/lib/llm';
import { sleep } from '@/lib/ai-core';
import Parser from 'rss-parser';
import { Innertube } from 'youtubei.js';

const parser = new Parser();
let innertube: Innertube | null = null;

async function getInnertube(): Promise<Innertube> {
  if (!innertube) {
    innertube = await Innertube.create({ lang: 'ko', location: 'KR' });
  }
  return innertube;
}

export class YouTubeCollector extends BaseCollector {
  readonly type = 'YOUTUBE_CHANNEL' as const;

  validate(config: unknown): boolean {
    const c = config as YouTubeChannelConfig;
    return !!c?.channelId;
  }

  protected async doCollect(source: CollectorSource): Promise<CollectedItem[]> {
    const config = source.config as unknown as YouTubeChannelConfig;
    if (!config?.channelId) throw new Error('channelId is required');

    const maxResults = config.maxResults ?? 20;
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${config.channelId}`;
    const feed = await parser.parseURL(feedUrl);
    const items: CollectedItem[] = [];

    // 전일자 필터: cron으로 실행 시 최근 48시간 이내 영상만 수집
    const cutoffDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const hasCron = !!source.cronExpr;

    for (const entry of feed.items.slice(0, maxResults)) {
      if (!entry.title || !entry.link) continue;

      // cron 수집 시 전일자 필터링 (수동 수집은 필터링 안함)
      if (hasCron && entry.pubDate) {
        const pubDate = new Date(entry.pubDate);
        if (pubDate < cutoffDate) continue;
      }

      const videoId = extractVideoId(entry.link);
      if (!videoId) continue;

      // 자막 추출 (Innertube → 페이지 파싱 fallback)
      let transcript: string | null = null;
      if (config.fetchTranscript !== false) {
        transcript = await this.fetchTranscriptInnertube(videoId);
        if (!transcript) {
          transcript = await this.fetchTranscriptPage(videoId);
        }
      }

      let content = transcript || entry.contentSnippet || entry.content || '';
      if (!content.trim()) {
        content = `[${entry.title}] YouTube 영상 (자막 없음)`;
      } else {
        content = content.replace(/<[^>]*>/g, '').trim();
      }

      let title = entry.title;
      let summary: string | undefined;
      const metadata: Record<string, unknown> = {
        channelId: config.channelId,
        channelName: feed.title,
        videoId,
        publishedAt: entry.pubDate,
        originalTitle: entry.title,
        hasTranscript: !!transcript,
      };

      // LLM 번역/요약 (자막이 있으면 내용이 충분하므로 번역)
      if (transcript && transcript.length > 100) {
        const translated = await translateAndSummarize(
          entry.title,
          content,
          `YouTube/${feed.title || config.channelId}`,
        );

        if (translated) {
          title = translated.titleKo;
          content = translated.contentKo;
          summary = translated.summary;
          metadata.originalContent = transcript;
          metadata.category = translated.category;
          metadata.importance = translated.importance;
        }

        await sleep(500);
      }

      items.push({
        externalId: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title,
        content,
        summary,
        metadata,
        publishedAt: entry.pubDate ? new Date(entry.pubDate) : undefined,
        tags: [
          ...(feed.title ? [feed.title] : []),
          ...(metadata.category ? [metadata.category as string] : []),
        ],
      });
    }

    return items;
  }

  /**
   * 1차: youtubei.js (Innertube API)
   */
  private async fetchTranscriptInnertube(videoId: string): Promise<string | null> {
    try {
      const yt = await getInnertube();
      const info = await yt.getInfo(videoId);
      const transcriptInfo = await info.getTranscript();

      if (!transcriptInfo?.transcript?.content?.body?.initial_segments) {
        return null;
      }

      const segments = transcriptInfo.transcript.content.body.initial_segments;
      const text = segments
        .map((seg: { snippet?: { text?: string } }) => seg.snippet?.text || '')
        .filter((t: string) => t.length > 0)
        .join(' ');

      if (text.length > 0) {
        console.log(`[YouTube] Innertube transcript: ${text.length} chars for ${videoId}`);
        return text;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 2차: 페이지 HTML 파싱 (fallback)
   */
  private async fetchTranscriptPage(videoId: string): Promise<string | null> {
    try {
      const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const response = await this.fetchWithRetry(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });
      const html = await response.text();

      const captionMatch = html.match(/"captionTracks":(\[.*?\])/);
      if (!captionMatch) return null;

      const tracks = JSON.parse(captionMatch[1]);
      const track =
        tracks.find((t: { languageCode: string }) => t.languageCode === 'ko') ||
        tracks.find((t: { languageCode: string }) => t.languageCode?.startsWith('en')) ||
        tracks[0];

      if (!track?.baseUrl) return null;

      const xmlResponse = await this.fetchWithRetry(track.baseUrl);
      const xml = await xmlResponse.text();

      const text = parseTranscriptXml(xml);
      if (text.length > 0) {
        console.log(`[YouTube] Page transcript: ${text.length} chars for ${videoId}`);
        return text;
      }
      return null;
    } catch {
      return null;
    }
  }
}

/** XML 디코딩 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\\n/g, ' ')
    .replace(/\n/g, ' ')
    .trim();
}

/** 초 → MM:SS 포맷 */
function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** XML 파싱 → 타임스탬프 세그먼트 배열 반환 */
function parseTranscriptXmlSegments(xml: string): { startSec: number; text: string }[] {
  const regex = /<text[^>]*\bstart="([^"]*)"[^>]*>([^<]*)<\/text>/g;
  const segments: { startSec: number; text: string }[] = [];
  let match;

  while ((match = regex.exec(xml)) !== null) {
    const startSec = parseFloat(match[1]) || 0;
    const text = decodeXmlEntities(match[2]);
    if (text.length > 0) segments.push({ startSec, text });
  }

  // start 속성 없는 경우 fallback (순서 보장)
  if (segments.length === 0) {
    const fallback = /<text[^>]*>([^<]*)<\/text>/g;
    while ((match = fallback.exec(xml)) !== null) {
      const text = decodeXmlEntities(match[1]);
      if (text.length > 0) segments.push({ startSec: 0, text });
    }
  }

  return segments;
}

/**
 * 자막 세그먼트를 시간 윈도우 단위로 그룹화
 * 기본 5분(300초) → 각 구간을 [MM:SS] 헤더로 구분
 */
function groupTranscriptByTime(
  segments: { startSec: number; text: string }[],
  windowSec = 300,
): string {
  if (segments.length === 0) return '';

  const groups: { startSec: number; texts: string[] }[] = [];
  let currentGroup: { startSec: number; texts: string[] } | null = null;

  for (const seg of segments) {
    if (!currentGroup || seg.startSec >= currentGroup.startSec + windowSec) {
      currentGroup = { startSec: seg.startSec, texts: [] };
      groups.push(currentGroup);
    }
    currentGroup.texts.push(seg.text);
  }

  return groups
    .map((g) => `[${formatTime(g.startSec)}]\n${g.texts.join(' ')}`)
    .join('\n\n');
}

/** 타임스탬프 그룹 포맷으로 반환 (단일 그룹이면 flat text) */
function parseTranscriptXml(xml: string): string {
  const segments = parseTranscriptXmlSegments(xml);
  if (segments.length === 0) return '';

  // 타임스탬프가 모두 0이면 flat text (타임스탬프 없는 자막)
  const hasTimestamps = segments.some((s) => s.startSec > 0);
  if (!hasTimestamps) {
    return segments.map((s) => s.text).join(' ');
  }

  return groupTranscriptByTime(segments);
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/,
    /youtube\.com\/shorts\/([^&\s?]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}
