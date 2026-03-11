# CLAUDE.md - RAG Collector

## 프로젝트 개요

팀용 RAG 인프라 서비스. 다양한 소스에서 데이터를 수집하고, pgvector 기반 벡터 검색으로 유사 문서를 조회.
outsource-hub 등 다른 프로젝트가 API/MCP로 활용하는 독립 서비스.

## 기술 스택

- **프레임워크**: Next.js 15.x (App Router)
- **언어**: TypeScript 5.x (strict mode)
- **스타일링**: TailwindCSS 4.x
- **ORM**: Prisma + pgvector
- **데이터베이스**: PostgreSQL 16 (vector extension)
- **임베딩**: Gemini embedding-001 (1536차원, 멀티모달)
- **인증**: JWT + API Key (bcrypt, jsonwebtoken)
- **MCP**: @modelcontextprotocol/sdk (stdio transport)
- **스케줄링**: node-cron (per-source 동적 cron)
- **패키지 매니저**: pnpm
- **포트**: 11009

## 주요 명령어

```bash
pnpm install       # 의존성 설치
pnpm dev           # 개발 서버 (포트: 11009)
pnpm build         # 프로덕션 빌드
pnpm db:generate   # Prisma 클라이언트 생성
pnpm db:push       # 스키마 DB 반영
pnpm db:studio     # Prisma Studio
node mcp-server.mjs  # MCP 서버 (stdio)
```

## 프로젝트 구조

```
src/
├── app/                        # Next.js App Router
│   ├── api/
│   │   ├── auth/               # 인증 (login, register, me)
│   │   ├── api-keys/           # API Key CRUD
│   │   ├── collections/        # 수집 이력 + 컬렉션 관리 (manage/)
│   │   ├── ingest/             # 텍스트/이미지 수집 API
│   │   ├── sources/            # 소스 CRUD
│   │   ├── collect/            # 수동 수집 트리거
│   │   ├── search/             # 벡터 검색
│   │   └── stats/              # 대시보드 통계
│   ├── api-keys/page.tsx       # API Key 관리 UI
│   ├── my-collections/page.tsx # 컬렉션 관리 UI
│   ├── settings/page.tsx       # 로그인/회원가입 UI
│   ├── sources/page.tsx        # 소스 관리 UI
│   ├── search/page.tsx         # 벡터 검색 + 업로드 UI
│   ├── collections/page.tsx    # 수집 이력 UI
│   └── page.tsx                # 대시보드
├── collectors/                 # 데이터 수집 플러그인 (7+1 타입)
├── lib/
│   ├── ai-core/index.ts        # GeminiEmbeddingProvider (1536차원, 멀티모달)
│   ├── auth.ts                 # JWT + API Key + Password 유틸
│   ├── prisma.ts               # Prisma 클라이언트 싱글톤
│   ├── scheduler.ts            # node-cron 동적 스케줄러
│   └── rag/
│       ├── embedding.ts        # pgvector 초기화/저장/이미지 임베딩
│       ├── indexer.ts          # chunk → embed → store
│       └── search.ts           # 벡터 유사도 검색 (컬렉션 필터 지원)
├── services/                   # 비즈니스 로직
└── instrumentation.ts          # 서버 시작 시 스케줄러 초기화

mcp-server.mjs                  # MCP 서버 (stdio, 5개 툴)
```

## 인증/권한

- **역할**: ADMIN / MEMBER / VIEWER
- **JWT**: `Authorization: Bearer <token>` (Web UI)
- **API Key**: `Authorization: ApiKey rag_xxx...` (MCP/외부 클라이언트)
- 첫 번째 가입 사용자는 자동으로 ADMIN

## MCP 서버 툴

| 툴 | 설명 | 읽기전용 |
|----|------|---------|
| `search` | 벡터 유사도 검색 | O |
| `ingest_text` | 텍스트 수집 | X |
| `ingest_image` | 이미지 수집 (로컬 파일 경로) | X |
| `list_collections` | 컬렉션 목록 | O |
| `get_stats` | 통계 조회 | O |

환경 변수: `RAG_COLLECTOR_URL`, `RAG_API_KEY`

## 컬렉션 가시성

- **PRIVATE**: 소유자만 접근
- **SHARED**: 인증된 팀원 공유
- **PUBLIC**: 전체 공개

## 데이터 파이프라인

```
Collector.collect() → CollectedItem[]
  → SHA-256 contentHash 중복 체크
  → Document 저장 (Prisma, 컬렉션 연결)
  → chunkText() (500자, 50 오버랩)
  → DocumentChunk 저장
  → GeminiEmbeddingProvider.embedBatch() (1536차원)
  → UPDATE document_chunks SET embedding = vector
```

## 인프라

- **Gitea**: http://192.168.0.67:3000/geng/rag-collector
- **Coolify**: http://192.168.0.67:8880
- **PostgreSQL**: localhost:5432/rag_collector
