import type { CollectorSource } from '@prisma/client';
import { BaseCollector } from './base-collector';
import type { CollectedItem, YouTubeChannelConfig } from './types';
import Parser from 'rss-parser';

const parser = new Parser();

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

      let content = entry.contentSnippet || entry.content || '';

      // 자막 가져오기 (옵션)
      if (config.fetchTranscript) {
        try {
          const transcript = await this.fetchTranscript(videoId);
          if (transcript) content = transcript;
        } catch (err) {
          console.warn(`[YouTube] Transcript fetch failed for ${videoId}:`, err);
        }
      }

      if (!content.trim()) {
        content = `[${entry.title}] YouTube 영상 (자막 없음)`;
      }

      items.push({
        externalId: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: entry.title,
        content: content.replace(/<[^>]*>/g, '').trim(),
        metadata: {
          channelId: config.channelId,
          channelName: feed.title,
          publishedAt: entry.pubDate,
        },
        publishedAt: entry.pubDate ? new Date(entry.pubDate) : undefined,
      });
    }

    return items;
  }

  private async fetchTranscript(videoId: string): Promise<string | null> {
    try {
      const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const response = await this.fetchWithRetry(pageUrl);
      const html = await response.text();

      const captionMatch = html.match(/"captionTracks":(\[.*?\])/);
      if (!captionMatch) return null;

      const tracks = JSON.parse(captionMatch[1]);
      const track = tracks.find((t: { languageCode: string }) => t.languageCode === 'ko')
        || tracks.find((t: { languageCode: string }) => t.languageCode === 'en')
        || tracks[0];

      if (!track?.baseUrl) return null;

      const xmlResponse = await this.fetchWithRetry(track.baseUrl);
      const xml = await xmlResponse.text();

      return xml
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
    } catch {
      return null;
    }
  }
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
