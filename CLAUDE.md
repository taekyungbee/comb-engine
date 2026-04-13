# CLAUDE.md - Comb Engine

## 프로젝트 개요

팀용 RAG 인프라 서비스. **모니터링/관리 UI + API 제공**만 담당.
실제 데이터 수집/활용은 전부 다른 앱에서 API 방식으로 수행.

### Comb 시리즈

| 프로젝트                | 역할                                            | 패키지명            |
| ----------------------- | ----------------------------------------------- | ------------------- |
| **comb-engine**         | RAG 코어 (모니터링 UI + API 제공)               | `comb-engine`       |
| **comb-hub**            | 팀 허브 (MCP+프로젝트 관리)                     | `comb-hub`          |
| **ai-trends-collector** | 인사이트 자동 수집 (YouTube, News, Moltbook 등) | —                   |
| **@side/comb-client**   | API 클라이언트                                  | `@side/comb-client` |

### 아키텍처 원칙

- **comb-engine** = 모니터링/관리 UI + API 제공 (자체 수집 스케줄러 없음)
- **실제 사용** = 전부 API 방식 (comb-hub, ai-trends-collector 등)
- comb-hub 패턴 참고: UI는 보여주기용, 실제 기능은 API로

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
- **스케줄링**: 없음 (자동 수집은 ai-trends-collector 담당)
- **패키지 매니저**: pnpm
- **포트**: 11009

### Collector 정책

Collector는 사용자가 UI에서 소스를 등록하면 수동으로 수집하는 용도.
**자동 수집이 필요한 경우** (YouTube, News, Moltbook 등)는 ai-trends-collector에서 API로 수집 후 comb-engine `/api/ingest`로 저장.

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

| 서비스         | 주소                                        | 비고                                  |
| -------------- | ------------------------------------------- | ------------------------------------- |
| **Qdrant**     | 192.168.0.67:12333                          | Docker, dev-server                    |
| **Reranker**   | 192.168.0.67:10800                          | Docker, dev-server                    |
| **PostgreSQL** | 192.168.0.67:5433                           | dev-server                            |
| **Ollama**     | 192.168.0.81:11434 (ai-server)              | Mac Mini M4, bge-m3                   |
| **GitHub**     | github.com/taekyungbee/comb-engine          | private repo                          |
| **Coolify**    | http://192.168.0.67:8000                    | 앱 배포 플랫폼                        |

### 서버 접속

| hostname     | IP           | 용도                                  |
| ------------ | ------------ | ------------------------------------- |
| ai-server    | 192.168.0.81 | Mac Mini M4, Ollama                   |
| (dev-server) | 192.168.0.67 | Qdrant, Reranker, PostgreSQL, Coolify |

## 인증/권한

- NextAuth v5 + Google OAuth
- 첫 1명만 ADMIN 자동 등록, 이후 가입 차단
- API Key: `Authorization: ApiKey comb_xxx...` (comb-hub 등 외부 클라이언트)
- 모든 API 엔드포인트는 인증이 필수입니다.

## 보안 강화 (Phase 2)

### API 인증

- 모든 API 라우트는 `authenticateRequest` 미들웨어 필요
- `/sources/[id]` 라우트는 이제 인증 필요 (이전 공개 접근 가능)
- API Key 형식: `Authorization: ApiKey rag_xxxxx...`

### Rate Limiting

- 기본: 1000 요청/분 per API key
- 헤더: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
- 초과 시: 429 응답

### API Key 관리

- Dashboard에서 API Key 생성/조회/삭제 가능
- Key는 생성 시 한 번만 표시 (이후 mask됨)
- Revocation은 즉시 발효 (grace period 없음)

### 환경변수 → DB 마이그레이션

- 전환기: `COMB_API_KEY` 환경변수 AND DB Key 모두 허용
- 전환 후: DB Key만 허용

## 데이터 파이프라인 (UI에서 소스 등록 시)

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

※ 자동 수집은 ai-trends-collector가 /api/ingest로 직접 저장
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

| 지표              | R8 점수   |
| ----------------- | --------- |
| Context Precision | 0.554     |
| Context Recall    | 0.656     |
| Faithfulness      | 0.718     |
| Answer Relevancy  | 0.698     |
| **OVERALL**       | **0.718** |

평가 스크립트: `scripts/eval-50tc-judge.ts` (z.ai glm-5)
키워드 평가: `scripts/eval-50tc.ts` (LLM 불필요)

## 작업 지침

### 장시간 작업은 맥미니(ai-server)에서 실행

임베딩, 마이그레이션, 대량 처리 등 시간이 오래 걸리는 작업은 로컬 PC가 아니라 맥미니에서 nohup으로 실행.

```bash
# 1. 로컬에서 소스 수정 + 커밋 + push
git push origin develop

# 2. 맥미니에서 pull (절대 맥미니에서 직접 소스 수정하지 않기!)
ssh ai-server "cd ~/dev/projects/side/comb-engine && git pull origin develop"

# 3. nohup으로 실행
ssh ai-server "cd ~/dev/projects/side/comb-engine && nohup env OLLAMA_URL=http://localhost:11434 npx tsx scripts/xxx.ts > xxx.log 2>&1 &"

# 4. 진행 확인
ssh ai-server "tail -3 ~/dev/projects/side/comb-engine/xxx.log"
```

- **맥미니에서 절대 소스 직접 수정 금지** — 반드시 로컬 수정 → push → pull 순서
- 로컬에서 동일 작업 병렬 실행 금지 (Ollama 점유 충돌)
- Ollama 배치 크기: 100 (content 기준)
- z.ai Judge 평가(50TC)도 ~45분 걸리므로 맥미니에서 실행 권장

```bash
# z.ai Judge 평가
ssh ai-server "cd ~/dev/projects/side/comb-engine && nohup env ZAI_API_KEY=xxx OLLAMA_URL=http://localhost:11434 QDRANT_COLLECTION=rag_production_v2 npx tsx scripts/eval-50tc-judge.ts > eval-judge.log 2>&1 &"
```

### 설계 확정 기준

- 확정된 설계/설정값은 실행 중 임의 변경하지 않기
- 새 스크립트 작성 시 기존 확정 설정을 반드시 참조
- 확정값: EMBED_BATCH=100, SCROLL_BATCH=500, Reranker ratio=0.5

### Vision(PPT/SB) 수집

PPT/화면기획서를 슬라이드별 이미지로 변환 → z.ai Vision(GLM-4.6V) 분석 → 임베딩 → Qdrant 적재.

```bash
# Python 스크립트 (건건이 파이프라인, 중단 후 이어하기 지원)
python3 scripts/sb-vision-ingest.py <pptx_path> --workers 4 --project komca

# 또는 소스 등록 후 자동 수집 (document-collector, ZAI_API_KEY 필요)
```

- z.ai Vision: `ZAI_API_KEY` + `ZAI_VISION_MODEL=glm-4.6v`
- LibreOffice로 슬라이드→이미지 변환 (서버에 설치 필요)
- 빈 슬라이드 자동 스킵

### 환경변수

| 변수                   | 용도                                       |
| ---------------------- | ------------------------------------------ |
| `COMB_ENGINE_URL`      | comb-engine API URL (구 RAG_COLLECTOR_URL) |
| `COMB_API_KEY`         | API Key (구 RAG_API_KEY)                   |
| `AUTH_SECRET`          | NextAuth 암호화 키                         |
| `GOOGLE_CLIENT_ID`     | Google OAuth                               |
| `GOOGLE_CLIENT_SECRET` | Google OAuth                               |
| `ZAI_API_KEY`          | z.ai LLM Judge                             |
