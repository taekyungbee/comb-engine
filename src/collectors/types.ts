import type { CollectorSource, SourceType } from '@prisma/client';

export interface CollectedItem {
  externalId: string;
  url?: string;
  title: string;
  content: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  publishedAt?: Date;
  tags?: string[];
}

export interface CollectorResult {
  items: CollectedItem[];
  errors: string[];
}

export interface Collector {
  readonly type: SourceType;
  collect(source: CollectorSource): Promise<CollectorResult>;
  validate(config: unknown): boolean;
}

// 소스별 config 타입
export interface WebCrawlConfig {
  selector?: string;
  maxDepth?: number;
  followLinks?: boolean;
  headers?: Record<string, string>;
}

export interface YouTubeChannelConfig {
  channelId: string;
  maxResults?: number;
  fetchTranscript?: boolean;
}

export interface RssFeedConfig {
  maxItems?: number;
  contentSelector?: string;
}

export interface GitHubRepoConfig {
  owner: string;
  repo: string;
  branch?: string;
  paths?: string[];
  includeIssues?: boolean;
}

export interface DocumentFileConfig {
  filePath: string;
  fileType: 'pdf' | 'md' | 'txt';
}

export interface NotionPageConfig {
  pageId: string;
  recursive?: boolean;
}

export interface MoltbookConfig {
  submolts?: string[];
  maxResults?: number;
  translate?: boolean;
}
