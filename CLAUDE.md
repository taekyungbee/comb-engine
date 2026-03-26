# CLAUDE.md - RAG Collector

## 프로젝트 개요

팀용 RAG 인프라 서비스. 다양한 소스에서 데이터를 수집하고, pgvector 기반 벡터 검색으로 유사 문서를 조회.
outsource-hub 등 다른 프로젝트가 API로 활용하는 독립 서비스.

## 기술 스택

- **프레임워크**: Next.js 15.x (App Router)
- **언어**: TypeScript 5.x (strict mode)
- **스타일링**: TailwindCSS 4.x
- **ORM**: Prisma (문서 메타데이터)
- **데이터베이스**: PostgreSQL 16 (문서/소스/컬렉션 메타데이터)
- **벡터DB**: Qdrant (dense + sparse Hybrid Search, RRF fusion)
- **임베딩(텍스트)**: bge-m3 1024d (Ollama 로컬, 비용 0원)
- **임베딩(멀티모달)**: Gemini embedding-002 3072d (이미지/표 전용, 별도 컬렉션)
- **Reranker**: bge-reranker-v2-m3 (FastAPI 서비스)
- **인증**: JWT + API Key (bcrypt, jsonwebtoken)
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
├── collectors/                 # 데이터 수집 플러그인 (12 타입)
├── lib/
│   ├── ai-core/index.ts        # OllamaEmbeddingProvider(bge-m3) + GeminiEmbeddingProvider(이미지)
│   ├── auth.ts                 # JWT + API Key + Password 유틸
│   ├── prisma.ts               # Prisma 클라이언트 싱글톤
│   ├── qdrant.ts               # Qdrant 클라이언트 + sparse vector 생성
│   ├── scheduler.ts            # node-cron 동적 스케줄러
│   └── rag/
│       ├── embedding.ts        # bge-m3 임베딩 (1024d) + 이미지 임베딩
│       ├── indexer.ts          # 수집 → smartChunk → embed → Qdrant 적재
│       └── search.ts           # Qdrant Hybrid Search + Reranker
├── services/                   # 비즈니스 로직
└── instrumentation.ts          # 서버 시작 시 스케줄러 초기화

```

## 역할

내부 데이터 인프라 서비스. 도메인 없이 내부 IP(192.168.0.67:11009)로만 운영.
outsource-hub가 API를 호출하여 데이터 저장/검색.

```
outsource-hub (outsource.lazyb.xyz)
├── MCP 서버 (팀원 접근)
└── RAG 툴 → rag-collector API (내부 IP) 호출

rag-collector (192.168.0.67:11009, 내부)
└── /api/search, /api/ingest → 임베딩/검색/저장
```

## 인증/권한

- **역할**: ADMIN / MEMBER / VIEWER
- **JWT**: `Authorization: Bearer <token>` (Web UI)
- **API Key**: `Authorization: ApiKey rag_xxx...` (outsource-hub 등 외부 클라이언트)
- 첫 번째 가입 사용자는 자동으로 ADMIN
- 회원가입 시 API Key 자동 발급

## API 엔드포인트

| 엔드포인트 | 설명 |
|-----------|------|
| `POST /api/search` | 벡터 유사도 검색 |
| `POST /api/ingest` | 텍스트/이미지 수집 (임베딩 자동 처리) |
| `GET /api/collections/manage` | 컬렉션 목록 |
| `GET /api/stats` | 통계 조회 |

## 컬렉션 가시성

- **PRIVATE**: 소유자만 접근
- **SHARED**: 인증된 팀원 공유
- **PUBLIC**: 전체 공개

## 데이터 파이프라인

```
Collector.collect() → CollectedItem[]
  → 쓰레기 데이터 필터링 (10자 미만 제외)
  → SHA-256 contentHash 중복 체크
  → Document 저장 (Prisma)
  → smartChunk(소스타입별 의미 단위 청킹)
  → 메타데이터 헤더 강화 (목적/파라미터/테이블)
  → bge-m3 임베딩 (1024d, Ollama 로컬)
  → Qdrant upsert (dense + sparse)
```

## 검색 파이프라인

```
Query → bge-m3 임베딩 + sparse vector 생성
  → Qdrant Dense top-20 + Sparse top-20 + Keyword filter
  → 합집합 → bge-reranker-v2-m3 (Reranker)
  → top-K 반환
  ※ Reranker 서비스 다운 시 Hybrid 점수로 fallback
```

## 인프라

| 서비스 | 주소 | 포트 규칙 |
|--------|------|----------|
| **Qdrant** | 192.168.0.67:12333 | 인프라(12000대) |
| **Reranker** | 192.168.0.67:10800 | API(10000대) |
| **PostgreSQL** | 192.168.0.67:5433 | 인프라 |
| **Ollama** | localhost:11434 | 로컬 |
| **Gitea** | http://192.168.0.67:3000/geng/rag-collector | |
| **Coolify** | http://192.168.0.67:8880 | |

## RAG 품질 (Ragas 공식 평가, 20TC)

| 지표 | 점수 |
|------|------|
| Context Precision | 0.894 |
| Context Recall | 0.950 |
| Faithfulness | 0.848 |
| Answer Relevancy | 0.849 |
| **OVERALL** | **0.885** |

Judge: gemini-2.5-flash, 평가 프레임워크: Ragas 0.4.3
