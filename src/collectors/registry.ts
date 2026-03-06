import type { SourceType } from '@prisma/client';
import type { Collector } from './types';
import { RssCollector } from './rss-collector';
import { WebCrawlCollector } from './web-crawler';
import { YouTubeCollector } from './youtube-collector';
import { GitHubCollector } from './github-collector';
import { NotionCollector } from './notion-collector';
import { DocumentCollector } from './document-collector';

const collectors = new Map<SourceType, Collector>();

function register(collector: Collector): void {
  collectors.set(collector.type, collector);
}

// 모든 collector 등록
register(new RssCollector());
register(new WebCrawlCollector());
register(new YouTubeCollector());
register(new GitHubCollector());
register(new NotionCollector());
register(new DocumentCollector());

export function getCollector(type: SourceType): Collector {
  const collector = collectors.get(type);
  if (!collector) throw new Error(`No collector registered for type: ${type}`);
  return collector;
}

export function getRegisteredTypes(): SourceType[] {
  return Array.from(collectors.keys());
}
