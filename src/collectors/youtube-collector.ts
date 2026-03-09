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

    for (const entry of feed.items.slice(0, maxResults)) {
      if (!entry.title || !entry.link) continue;

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

function parseTranscriptXml(xml: string): string {
  const regex = /<text[^>]*>([^<]*)<\/text>/g;
  const texts: string[] = [];
  let match;

  while ((match = regex.exec(xml)) !== null) {
    const text = match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/\\n/g, ' ')
      .replace(/\n/g, ' ')
      .trim();
    if (text.length > 0) texts.push(text);
  }

  return texts.join(' ');
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
