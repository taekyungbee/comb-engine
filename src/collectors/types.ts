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
  /** true 면 소스의 현재 항목 전체를 훑은 결과 → seenExternalIds 에 없는 기존 문서는 삭제 대상 */
  fullSync?: boolean;
  /** fullSync 일 때 소스에 현재 존재하는 externalId 전체 */
  seenExternalIds?: string[];
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

export interface BaaldaConfig {
  /** MCP 엔드포인트 (기본 https://baalda.lazyb.xyz/api/mcp) */
  mcpUrl?: string;
  /** 토큰을 담은 환경변수 이름 (기본 BAALDA_MCP_TOKEN). 토큰 자체는 config 에 두지 않는다 */
  tokenEnv?: string;
  /** 수집할 vault id 목록. 비우면 토큰이 닿는 vault 전부 */
  vaultIds?: string[];
  /** 증분 기준 시각(ISO) 강제. 없으면 직전 성공 run(lastRunAt) 기준, 그것도 없으면 전체 */
  since?: string;
  /** 전체 동기화 강제 (삭제된 노트 정리 포함) */
  fullSync?: boolean;
  /** 한 run 에서 읽을 최대 노트 수 (기본 2000) */
  maxNotes?: number;
}
