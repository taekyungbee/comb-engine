import type { CollectorSource } from '@prisma/client';
import { BaseCollector } from './base-collector';
import type { CollectedItem, RssFeedConfig } from './types';
import Parser from 'rss-parser';

const parser = new Parser();

export class RssCollector extends BaseCollector {
  readonly type = 'RSS_FEED' as const;

  validate(config: unknown): boolean {
    return true; // RSS는 url만 있으면 됨
  }

  protected async doCollect(source: CollectorSource): Promise<CollectedItem[]> {
    if (!source.url) throw new Error('RSS feed URL is required');

    const config = source.config as unknown as RssFeedConfig;
    const maxItems = config?.maxItems ?? 50;

    const feed = await parser.parseURL(source.url);
    const items: CollectedItem[] = [];

    for (const entry of feed.items.slice(0, maxItems)) {
      if (!entry.title || !entry.link) continue;

      const content = entry.contentSnippet || entry.content || entry.summary || '';
      if (!content.trim()) continue;

      items.push({
        externalId: entry.guid || entry.link,
        url: entry.link,
        title: entry.title,
        content: stripHtml(content),
        metadata: {
          author: entry.creator || entry.author,
          feedTitle: feed.title,
          categories: entry.categories,
        },
        publishedAt: entry.pubDate ? new Date(entry.pubDate) : undefined,
      });
    }

    return items;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
