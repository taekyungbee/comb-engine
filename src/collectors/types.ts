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
  fileType: 'pdf' | 'md' | 'txt' | 'pptx' | 'ppt' | 'xlsx' | 'xls' | 'docx' | 'doc' | 'odp' | 'ods' | 'odt' | 'rtf' | 'csv';
}

export interface GoogleWorkspaceConfig {
  fileId: string;
  fileType: 'document' | 'spreadsheet' | 'presentation';
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

export interface GmailConfig {
  query: string;
  maxResults?: number;
}

export interface GoogleCalendarConfig {
  calendarId?: string;
  daysBack?: number;
  daysForward?: number;
}

export interface GoogleChatConfig {
  spaceId: string;
  maxResults?: number;
  daysBack?: number;
}

export interface GitCloneConfig {
  gitUrl: string;
  branch?: string;
  paths?: string[];
  extensions?: string[];
  maxFileSize?: number;
  includeTests?: boolean;
}

export interface DatabaseConfig {
  dbType: 'oracle' | 'postgresql' | 'mysql';
  connectionString: string;
  user?: string;
  password?: string;
  schemas?: string[];
  objectTypes?: Array<'TABLE' | 'PROCEDURE' | 'FUNCTION' | 'VIEW'>;
  maxRows?: number;
  includeColumnInfo?: boolean;
  includeDDL?: boolean;
}
