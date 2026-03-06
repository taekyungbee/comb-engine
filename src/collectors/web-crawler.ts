import type { CollectorSource } from '@prisma/client';
import { BaseCollector } from './base-collector';
import type { CollectedItem, WebCrawlConfig } from './types';
import * as cheerio from 'cheerio';
import { createHash } from 'crypto';

export class WebCrawlCollector extends BaseCollector {
  readonly type = 'WEB_CRAWL' as const;

  validate(config: unknown): boolean {
    return true;
  }

  protected async doCollect(source: CollectorSource): Promise<CollectedItem[]> {
    if (!source.url) throw new Error('URL is required for web crawling');

    const config = source.config as unknown as WebCrawlConfig;
    const visited = new Set<string>();
    const items: CollectedItem[] = [];
    const maxDepth = config?.maxDepth ?? 0;

    await this.crawlPage(source.url, config, visited, items, 0, maxDepth);

    return items;
  }

  private async crawlPage(
    url: string,
    config: WebCrawlConfig | undefined,
    visited: Set<string>,
    items: CollectedItem[],
    depth: number,
    maxDepth: number
  ): Promise<void> {
    const normalizedUrl = url.split('#')[0].split('?')[0];
    if (visited.has(normalizedUrl)) return;
    visited.add(normalizedUrl);

    const response = await this.fetchWithRetry(url, {
      headers: config?.headers,
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    // 불필요한 요소 제거
    $('script, style, nav, footer, header, aside, .sidebar, .menu, .ad').remove();

    const selector = config?.selector || 'article, main, .content, .post-content, body';
    const content = $(selector).text().replace(/\s+/g, ' ').trim();

    if (content.length > 50) {
      const title = $('title').text().trim() || $('h1').first().text().trim() || url;

      items.push({
        externalId: createHash('md5').update(normalizedUrl).digest('hex'),
        url: normalizedUrl,
        title,
        content,
        metadata: {
          description: $('meta[name="description"]').attr('content'),
          crawledUrl: url,
        },
      });
    }

    // 링크 따라가기
    if (config?.followLinks && depth < maxDepth) {
      const links: string[] = [];
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;

        try {
          const absoluteUrl = new URL(href, url).href;
          const baseHost = new URL(url).host;
          if (new URL(absoluteUrl).host === baseHost && !visited.has(absoluteUrl.split('#')[0].split('?')[0])) {
            links.push(absoluteUrl);
          }
        } catch {
          // invalid URL
        }
      });

      for (const link of links.slice(0, 20)) {
        await this.crawlPage(link, config, visited, items, depth + 1, maxDepth);
      }
    }
  }
}
