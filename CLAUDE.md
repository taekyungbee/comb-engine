# CLAUDE.md - Comb Engine

## 프로젝트 개요

팀용 RAG 인프라 서비스 (구 rag-collector). 다양한 소스에서 데이터를 수집하고, Qdrant 기반 벡터 검색으로 유사 문서를 조회.
comb-hub 등 다른 프로젝트가 `@side/comb-client` 패키지 또는 API로 활용하는 독립 서비스.

### Comb 시리즈

| 프로젝트 | 역할 | 패키지명 |
|---------|------|---------|
| **comb-engine** | RAG 인프라 (수집+검색+임베딩) | `comb-engine` |
| **comb-hub** | 팀 허브 (MCP+프로젝트 관리) | `comb-hub` |
| **@side/comb-client** | API 클라이언트 | `@side/comb-client` |

## 기술 스택

- **프레임워크**: Next.js 15.x (App Router)
- **언어**: TypeScript 5.x (strict mode)
- **스타일링**: TailwindCSS 4.x + LUDS (Honey Gold + Deep Onyx)
- **ORM**: Prisma (문서 메타데이터)
- **데이터베이스**: PostgreSQL 16 (문서/소스/컬렉션 메타데이터)
- **벡터DB**: Qdrant (3-Way Fusion: dense + sparse + alias)
- **임베딩(텍스트)**: bge-m3 1024d (Ollama, ai-server)
- **임베딩(멀티모달)**: Gemini embedding-002 3072d (이미지/표 전용)
- **Reranker**: bge-reranker-v2-m3 (FastAPI 서비스)
- **인증**: NextAuth v5 + Google OAuth (1명 제한)
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

## 인프라

| 서비스 | 주소 | 비고 |
|--------|------|------|
| **Qdrant** | 192.168.0.67:12333 | Docker, dev-server |
| **Reranker** | 192.168.0.67:10800 | Docker, dev-server |
| **PostgreSQL** | 192.168.0.67:5433 | dev-server |
| **Ollama** | 192.168.0.81:11434 (ai-server) | Mac Mini M4, bge-m3 |
| **Gitea** | http://192.168.0.67:3000/geng/rag-collector | |
| **Coolify** | http://192.168.0.67:8880 | |

### 서버 접속

| hostname | IP | 용도 |
|----------|----|------|
| ai-server | 192.168.0.81 | Mac Mini M4, Ollama |
| (dev-server) | 192.168.0.67 | Qdrant, Reranker, PostgreSQL, Coolify |

## 인증/권한

- NextAuth v5 + Google OAuth
- 첫 1명만 ADMIN 자동 등록, 이후 가입 차단
- API Key: `Authorization: ApiKey rag_xxx...` (comb-hub 등 외부 클라이언트)

## 데이터 파이프라인

```
Collector.collect() → CollectedItem[]
  → 쓰레기 데이터 필터링 (10자 미만 제외)
  → SHA-256 contentHash 중복 체크
  → Document 저장 (Prisma)
  → smartChunk(소스타입별 의미 단위 청킹)
  → 메타데이터 헤더 강화 (목적/파라미터/테이블)
  → bge-m3 임베딩 (1024d, Ollama ai-server)
  → alias 임베딩 (코드명+한국어별칭, bge-m3)
  → Qdrant upsert (dense + sparse + alias)
```

## 검색 파이프라인 (3-Way Fusion)

```
Query → bge-m3 임베딩 + sparse vector 생성
  → Qdrant 3-Way Prefetch:
    - Dense top-20 (의미 검색)
    - Sparse top-20 (키워드 매칭)
    - Alias top-15 (한국어↔코드명 브릿지)
  → RRF Fusion
  → Keyword filter (식별자 정확 매칭)
  → bge-reranker-v2-m3 (Reranker, ratio 0.5 필터링)
  → top-K 반환
  ※ Reranker 서비스 다운 시 Hybrid 점수로 fallback
```

## RAG 품질 (z.ai glm-5 Judge, 50TC)

| 지표 | R2 점수 |
|------|---------|
| Context Precision | 0.665 |
| Context Recall | 0.906 |
| Faithfulness | 0.928 |
| Answer Relevancy | 0.915 |
| **OVERALL** | **0.854** |

평가 스크립트: `scripts/eval-50tc-judge.ts` (z.ai glm-5)
키워드 평가: `scripts/eval-50tc.ts` (LLM 불필요)

## 작업 지침

### 장시간 작업은 맥미니(ai-server)에서 실행

임베딩, 마이그레이션, 대량 처리 등 시간이 오래 걸리는 작업은 로컬 PC가 아니라 맥미니에서 nohup으로 실행.

```bash
# 1. 소스 push 후 맥미니에서 pull
ssh ai-server "cd ~/dev/projects/side/rag-collector && git pull origin develop"

# 2. nohup으로 실행
ssh ai-server "cd ~/dev/projects/side/rag-collector && nohup env OLLAMA_URL=http://localhost:11434 npx tsx scripts/xxx.ts > xxx.log 2>&1 &"

# 3. 진행 확인
ssh ai-server "tail -3 ~/dev/projects/side/rag-collector/xxx.log"
```

- 로컬에서 동일 작업 병렬 실행 금지 (Ollama 점유 충돌)
- Ollama 배치 크기: 100 (content 기준)

### 설계 확정 기준

- 확정된 설계/설정값은 실행 중 임의 변경하지 않기
- 새 스크립트 작성 시 기존 확정 설정을 반드시 참조
- 확정값: EMBED_BATCH=100, SCROLL_BATCH=500, Reranker ratio=0.5

### 환경변수

| 변수 | 용도 |
|------|------|
| `COMB_ENGINE_URL` | comb-engine API URL (구 RAG_COLLECTOR_URL) |
| `COMB_API_KEY` | API Key (구 RAG_API_KEY) |
| `AUTH_SECRET` | NextAuth 암호화 키 |
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `ZAI_API_KEY` | z.ai LLM Judge |
