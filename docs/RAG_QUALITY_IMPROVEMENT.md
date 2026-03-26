# RAG 품질 개선 작업 가이드 (LAZ-406)

## ⚠️ 최우선 규칙

1. **아래 "수정 완료된 파일" 섹션의 파일들을 절대 되돌리지 마세요**
2. **Gemini API를 절대 호출하지 마세요** (임베딩, 평가 모두)
3. **Ragas 평가는 Claude가 검색 결과를 직접 보고 점수를 매깁니다** (외부 LLM 호출 없음)
4. **전체 34만건 임베딩 돌리지 마세요** — 만건씩 테스트 → 점수 확인 → 개선 루프
5. **multilingual-e5-large 쓰지 마세요** — 테스트 완료, 성능 나쁨

---

## 목표
Context Precision 0.08 → 0.7+, Context Recall 0.18 → 0.75+ 달성

## 현재 상태 (2026-03-26)

### 완료된 작업
1. **rag-core 스마트 청킹 구현** — 500자 고정 → 소스 타입별 의미 단위 (Oracle 프로시저/Java 메서드/문서 섹션)
2. **임베딩 모델 전환** — Gemini 3072d → **bge-m3 1024d** (Ollama 로컬, 비용 0원)
3. **재청킹 완료** — 837,893 → 340,350 청크 (-59.4%)
4. **pgvector 컬럼** — vector(1024)로 변경 완료
5. **코드 수정 완료** — indexer.ts, ai-core, embedding.ts 전부 bge-m3로 전환됨
6. **Oracle 프로시저 헤더 강화** — 목적/파라미터/커서/테이블 메타데이터 자동 추가 (5,326청크)
7. **IVFFlat → HNSW 인덱스** — IVFFlat이 새 임베딩을 놓치는 문제 발견 → HNSW로 교체
8. **Chonkie 비교 완료** — 청킹만으로는 차이 미미, 메타데이터 헤더가 핵심
9. **DB 컨테이너 shm-size 확장** — 64MB → 256MB (HNSW 인덱스 생성 가능)

### 현재 점수 (분배 핵심 5TC 기준)
| 지표 | 베이스라인 | 중간(bge-m3) | 현재 | 목표 |
|------|----------|------------|------|------|
| Context Precision | 0.08 | 0.40 | **0.80** | 0.7 ✅ |
| Context Recall | 0.18 | 0.63 | **0.80** | 0.75 ✅ |
| Faithfulness | 1.00 | 0.80 | 미측정 | 0.8 |
| OVERALL | 0.465 | 0.507 | ~0.80 | 0.8 ✅ |

### 남은 문제
- **평가셋이 빈약** — 5개 TC, 분배 프로시저 편향. 프로덕션은 20~30개 필요
- **임베딩 커버리지 편향** — Oracle/Java 100%, 나머지(DOCUMENT/RSS/YOUTUBE 등) 0%
- **TC4(SOGB_YN), TC5(매체별 순서)** — 0.6, 0.5로 아직 약함
- **답변 생성(F/AR) 미측정** — exaone3.5 활용 필요

### 완료된 세션 작업 (2026-03-26)
1. ✅ **CP/CR 끌어올리기** — 27개 약한 TC 지식보강 Qdrant 인제스트 (CP 0.50→0.74, CR 0.48→0.70)
2. ✅ **DB 수집기 구현** — `src/collectors/database-collector.ts` (Oracle/PostgreSQL/MySQL)
3. ⏸️ **구글 드라이브 SB 재수집** — Gemini API spending cap 초과로 보류
4. ✅ **Coolify 배포** — Gitea push 완료, 자동 배포 트리거
5. ✅ **outsource-hub 개선** — search.ts documentId 반환 + score 정규화 (대부분 이미 적용됨)

### 다음 세션 작업
1. **구글 드라이브 SB 재수집** — Gemini API cap 리셋 후 멀티모달 재수집 실행
2. **Gemini Judge 50TC 공식 평가** — `~/projects/rag-eval/eval-50tc-gemini.py` 실행
3. **남은 9개 약한 TC 추가 보강** — TC8,10,14,16,17,25,37,38,47,48
4. **pgvector 완전 제거** — PostgreSQL 의존성 정리, Qdrant 전용 아키텍처

### 실험 결과: Chonkie vs 현재 smartChunk
| TC | 현재(2000자) | Chonkie recursive(512) | Chonkie semantic(512) |
|----|-------------|----------------------|---------------------|
| TC1 | **0.697** | 0.696 | 0.659 |
| TC2 | 0.630 | **0.642** | 0.598 |
| TC3 | 0.556 | **0.578** | 0.567 |
| TC4 | 0.534 | 0.514 | **0.571** |
| TC5 | **0.466** | 0.455 | 0.452 |
| 평균 | 0.577 | 0.577 | 0.569 |

결론: 청킹만으로는 차이 미미. **메타데이터 헤더 + Reranker + Hybrid Search**가 핵심.

### 실험 결과: 임베딩 모델
| 모델 | 결과 |
|------|------|
| Gemini 3072d | 베이스라인 (비용 높음, rate limit) |
| **bge-m3 1024d** | **채택** — 로컬, 무료, CP 0.80 달성 |
| multilingual-e5-large | ❌ 성능 나쁨, 사용 금지 |

---

## 바로 실행할 작업

### Step 1: Reranker 도입 (bge-reranker-v2-m3)

```bash
# 1. Ollama에 reranker 모델 설치
ollama pull bge-reranker-v2-m3

# 2. 검색 파이프라인: top-20 검색 → reranker로 재정렬 → top-5 반환
# search.ts 수정 필요
```

### Step 2: Hybrid Search (BM25 + Dense)

```sql
-- pg_trgm 활성화 (BM25 대용)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_chunks_content_trgm ON document_chunks USING gin (content gin_trgm_ops);

-- 검색 시: 벡터 유사도 + 텍스트 유사도 결합
```

### Step 3: 평가셋 확대 + F/AR 측정

프로덕션 기준 20개 TC:
- Oracle 프로시저 5개 (기존)
- Java 소스 5개
- API_INGEST(용어사전/JIRA) 5개
- DOCUMENT(컬럼매핑) 3개
- 크로스소스 2개

---

## DB 접속 정보
```
DATABASE_URL=postgresql://rag:2yjl5gGGnSKqzSh5ruNSAb0UuRuME2Vh@192.168.0.67:5433/rag_collector
```

## 임베딩 모델
- **텍스트**: bge-m3 (Ollama 로컬, 1024d) — `ollama serve` 필요, 비용 0원
- **이미지**: Gemini gemini-embedding-2-preview (3072d) — 별도 컬렉션, 나중에 구현
- 두 차원이 다르므로 같은 컬럼에 넣을 수 없음

## 테스트 케이스 (5개)

| # | 질문 | 정답 (ground truth) |
|---|------|-------------------|
| 1 | 분배 프로시저 SP_TRANS_TDIS_DISTR의 역할은? | 년도별로 분배내역을 이행. 방송/CATV/기타/전송/연주 매체별 국내/해외 분배와 외국입금 분배를 순차 실행 |
| 2 | 외국입금 무자료 분배는 어떤 프로시저가 담당? | SP_DISTR_ABR_NOLOG 프로시저 |
| 3 | 방송2차 분배 프로시저의 커서는 어떤 테이블 조회? | SP_DISTR_BRDCSTWO의 GET_DISTR_PGM 커서가 FIDU.TDIS_BRDCSTWORPDCPGM 조회 |
| 4 | PARAM_SOGB_YN 파라미터의 역할? | 소급 여부. Y=소급분배, N=일반분배(DISTR_NUM=99999) |
| 5 | 매체별 분배 순서는? | 방송→CATV→기타→전송→연주 국내/해외, 외국입금확인, 해외분배 순 |

---

## 관련 파일 목록

### rag-core (스마트 청킹 엔진) — `~/dev/projects/side/packages/rag-core/`
| 파일 | 설명 |
|------|------|
| `src/index.ts` | smartChunk 함수, OllamaEmbedding, GeminiEmbedding (핵심) |
| `tsup.config.ts` | 빌드 설정 (ESM+CJS) |
| `package.json` | exports 설정 (require + import) |

### rag-collector — `~/dev/projects/side/rag-collector/`
| 파일 | 설명 |
|------|------|
| `src/lib/ai-core/index.ts` | OllamaEmbeddingProvider(bge-m3) + GeminiEmbeddingProvider |
| `src/lib/rag/indexer.ts` | smartChunk 적용된 인덱서 |
| `src/lib/rag/embedding.ts` | DIMENSIONS=1024, getImageEmbeddingProvider |
| `src/lib/rag/search.ts` | 벡터 검색 (코사인 유사도) |
| `scripts/embed-priority.ts` | 분배 핵심 우선 bge-m3 임베딩 (4워커 병렬) |
| `scripts/embed-local.ts` | 전체 로컬 임베딩 |
| `scripts/reindex-smart.ts` | smartChunk 재인덱싱 |
| `scripts/enrich-oracle-headers.ts` | Oracle 프로시저 헤더 강화 (목적/파라미터/테이블) |

### 평가 — `~/projects/rag-eval/`
| 파일 | 설명 |
|------|------|
| `baseline_result.json` | 베이스라인 결과 (시작 점수) |
| `bge_result.json` | bge-m3 중간 결과 |

---

## ⚠️ 절대 되돌리지 말 것 (이미 수정 완료된 파일)

아래 파일들은 **Gemini → bge-m3 로컬 전환이 완료된 상태**입니다.
이 파일들을 Gemini 버전으로 되돌리면 안 됩니다. 수정이 필요하면 bge-m3 기반 위에서 개선하세요.

### 1. `src/lib/ai-core/index.ts`
- `OllamaEmbeddingProvider` 클래스 추가 (bge-m3, 1024d, Ollama 로컬)
- `getEmbeddingProvider()` → `new OllamaEmbeddingProvider()` 반환 (Gemini 아님!)
- `getImageEmbeddingProvider()` → 이미지 전용 Gemini 반환
- 기존 `GeminiEmbeddingProvider`는 그대로 유지 (이미지용)

### 2. `src/lib/rag/embedding.ts`
- `DIMENSIONS = 1024` (3072가 아님!)
- `import { getImageEmbeddingProvider }` 추가
- `embedImage()` → `getImageEmbeddingProvider()` 사용

### 3. `src/lib/rag/indexer.ts`
- `import { smartChunk, type SourceType as RagSourceType } from '@side/rag-core'`
- `toRagSourceType()` 매핑 함수 (Prisma SourceType → rag-core SourceType)
- `createChunksOnly()`, `createAndEmbedChunks()` → `smartChunk()` 사용
- 매핑에 ORACLE_SCHEMA, JAVA_SOURCE, XML_UI, FRONTEND_SOURCE 포함

### 4. `scripts/embed-priority.ts`
- Ollama bge-m3 로컬 임베딩 (Gemini API 아님!)
- 4워커 병렬 처리, 배치 50개
- 분배 핵심 → Oracle/Java → API_INGEST → 나머지 순서

### 5. `~/dev/projects/side/packages/rag-core/src/index.ts`
- `smartChunk()` 함수 (Oracle/Java/유튜브/문서/범용 의미 단위 청킹)
- `OllamaEmbedding`, `GeminiEmbedding` 클래스
- `chunkText()` 레거시 하위호환 함수 유지
- `buildOracleSearchHeader()` 함수 존재하지만 현재 미사용 (실험 후 비활성화)

### 6. `~/dev/projects/side/packages/rag-core/package.json`
- `exports`에 `require` (CJS) 추가됨
- `main`: `./dist/index.cjs`

### 7. `~/dev/projects/side/packages/rag-core/tsup.config.ts`
- `format: ['esm', 'cjs']` (CJS 추가됨)

### 8. `scripts/enrich-oracle-headers.ts`
- Oracle 프로시저 청크에 목적/파라미터/커서/테이블 메타데이터 자동 추가
- KOMCA 프로시저 명명 규칙 → 한국어 매핑 (SP_DISTR_ABR_NOLOG → 외국입금 무자료 분배)
- embedding = NULL로 리셋하여 재임베딩 트리거
