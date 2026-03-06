# CLAUDE.md - RAG Collector

## 프로젝트 개요

자동화된 데이터 수집 + RAG(Retrieval-Augmented Generation) 파이프라인.
다양한 소스(RSS, 웹, YouTube, GitHub, Notion, PDF)에서 데이터를 수집하고,
pgvector 기반 벡터 검색으로 유사 문서를 조회하는 시스템.

## 기술 스택

- **프레임워크**: Next.js 15.x (App Router)
- **언어**: TypeScript 5.x (strict mode)
- **스타일링**: TailwindCSS 4.x
- **ORM**: Prisma + pgvector
- **데이터베이스**: PostgreSQL 16 (vector extension)
- **임베딩**: Ollama nomic-embed-text (768차원)
- **스케줄링**: node-cron (per-source 동적 cron)
- **패키지 매니저**: pnpm
- **포트**: 11008

## 주요 명령어

```bash
pnpm install       # 의존성 설치
pnpm dev           # 개발 서버 (포트: 11008)
pnpm build         # 프로덕션 빌드
pnpm db:generate   # Prisma 클라이언트 생성
pnpm db:push       # 스키마 DB 반영
pnpm db:studio     # Prisma Studio
```

## 프로젝트 구조

```
src/
├── app/                        # Next.js App Router
│   ├── api/                    # API Routes
│   │   ├── sources/            # 소스 CRUD
│   │   ├── collect/            # 수동 수집 트리거
│   │   ├── search/             # 벡터 검색
│   │   ├── collections/        # 수집 이력
│   │   └── stats/              # 대시보드 통계
│   ├── sources/page.tsx        # 소스 관리 UI
│   ├── search/page.tsx         # 벡터 검색 UI
│   ├── collections/page.tsx    # 수집 이력 UI
│   └── page.tsx                # 대시보드
├── collectors/                 # 데이터 수집 플러그인
│   ├── types.ts                # Collector 인터페이스
│   ├── registry.ts             # 플러그인 레지스트리
│   ├── base-collector.ts       # 공통 로직 (dedup, retry)
│   ├── rss-collector.ts        # RSS/Atom 피드
│   ├── web-crawler.ts          # 웹 크롤링 (cheerio)
│   ├── youtube-collector.ts    # YouTube RSS + 자막
│   ├── github-collector.ts     # GitHub REST API
│   ├── notion-collector.ts     # Notion API
│   └── document-collector.ts   # PDF/Markdown 파일
├── lib/
│   ├── ai-core/                # 임베딩/청킹 유틸리티 (standalone)
│   ├── prisma.ts               # Prisma 클라이언트 싱글톤
│   ├── scheduler.ts            # node-cron 동적 스케줄러
│   └── rag/
│       ├── embedding.ts        # pgvector 초기화/저장
│       ├── indexer.ts          # chunk → embed → store
│       └── search.ts           # 벡터 유사도 검색
├── services/
│   ├── source.service.ts       # 소스 CRUD
│   ├── collection.service.ts   # 수집 실행 관리
│   └── search.service.ts       # 검색 서비스
└── instrumentation.ts          # 서버 시작 시 스케줄러 초기화
```

## Collector 타입별 config

| SourceType | config 필드 |
|-----------|-------------|
| `RSS_FEED` | `{ maxItems? }` |
| `WEB_CRAWL` | `{ selector?, maxDepth?, followLinks?, headers? }` |
| `YOUTUBE_CHANNEL` | `{ channelId, maxResults?, fetchTranscript? }` |
| `GITHUB_REPO` | `{ owner, repo, branch?, paths?, includeIssues? }` |
| `NOTION_PAGE` | `{ pageId, recursive? }` |
| `DOCUMENT_FILE` | `{ filePath, fileType }` |

## 데이터 파이프라인

```
Collector.collect() → CollectedItem[]
  → SHA-256 contentHash 중복 체크
  → Document 저장 (Prisma)
  → chunkText() (500자, 50 오버랩)
  → DocumentChunk 저장
  → OllamaEmbeddingProvider.embedBatch()
  → UPDATE document_chunks SET embedding = vector
```

## 인프라

- **Gitea**: http://192.168.0.67:3000/geng/rag-collector
- **Coolify**: http://192.168.0.67:8880
- **PostgreSQL**: localhost:5432/rag_collector
- **Ollama**: http://192.168.0.67:11434
