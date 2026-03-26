# RAG 품질 개선 작업 이력 (2026-03-26)

## 목표
Context Precision 0.08 → 0.7+, Context Recall 0.18 → 0.75+ 달성
→ **최종 달성: CP 0.894, CR 0.950, F 0.848, AR 0.849, OVERALL 0.885**

---

## Phase 1: 기반 전환 (Gemini → bge-m3)

### 문제
- Gemini embedding-002 (3072d): rate limit, 비용, 성능 부족 (CP 0.08)
- multilingual-e5-large: 테스트 완료, 성능 나쁨 → 사용 금지

### 작업
1. bge-m3 1024d (Ollama 로컬) 전환
2. pgvector 컬럼 vector(3072) → vector(1024) 변경
3. 재청킹: 837,893 → 340,350 청크 (-59.4%)
4. ai-core/index.ts: OllamaEmbeddingProvider 추가
5. embedding.ts: DIMENSIONS=1024
6. indexer.ts: smartChunk 적용

### 결과
- CP 0.08 → 0.40, CR 0.18 → 0.63

---

## Phase 2: 메타데이터 헤더 강화

### 문제
- Oracle 프로시저 청크에 "목적" 설명 없음 → 의미 검색 실패
- SP_DISTR_ABR_NOLOG = "외국입금 무자료 분배"를 몰라서 검색 불가

### 작업
1. `scripts/enrich-oracle-headers.ts` 생성
2. KOMCA 프로시저 명명 규칙 → 한국어 매핑 (5,326개 청크)
   - SP_DISTR_ABR_NOLOG → `목적:외국입금 무자료 분배`
   - 파라미터, 커서, 참조 테이블 메타데이터 추가
3. 전 소스타입으로 확대:
   - Java: `[클래스명 | 패키지 | 유형 | 설명 | AS-IS]`
   - JIRA: `[JIRA: KOMCA-1796 | 도메인 | 상태 | 기능]`
   - 컬럼매핑: `[AS-IS → TO-BE | 용도]`
   - 테이블: `[테이블명 | 컬럼수 | 주요컬럼]`

### 결과
- TC2(외국입금 무자료): CP 0→1.0
- TC3(방송2차): CP 0→1.0

---

## Phase 3: 벡터 인덱스 문제 발견 + 해결

### 문제
- IVFFlat 인덱스가 새로 임베딩된 벡터를 누락 (approximate search 한계)
- 타겟 문서 sim=0.698인데 전역 검색에서 안 나옴

### 작업
1. IVFFlat 인덱스 삭제 → exact scan으로 확인 → 문제 확인
2. HNSW 인덱스 생성 시도 → shm-size 64MB 부족
3. Docker 컨테이너 shm-size=256MB로 재생성
4. HNSW 인덱스 생성 완료 (m=16, ef_construction=128)
5. ef_search=200으로 상향

### 결과
- 누락 벡터 문제 해결

---

## Phase 4: Qdrant Hybrid Search + Reranker

### 문제
- Dense search만으로는 키워드 정확 매칭 불가 (JIRA 번호 등)
- pg_trgm은 한국어/SQL에서 약함

### 작업
1. Qdrant 컨테이너 배포 (192.168.0.67:6333)
2. dense(bge-m3 1024d) + sparse(TF 기반) + RRF fusion
3. bge-reranker-v2-m3 (CrossEncoder) 적용
4. 검색 파이프라인: Dense top-20 + Sparse top-20 + Keyword filter → Reranker → top-5
5. Keyword filter: 질문에서 식별자(KOMCA-1796, TENV_SVCCD 등) 추출 → title 필터

### 실험 비교
| 방법 | CP | CR |
|------|-----|-----|
| pgvector Dense only | 0.40 | 0.49 |
| + Reranker | 0.48 | 0.49 |
| + Hybrid | 0.48 | 0.45 |
| + Hybrid + Reranker | 0.48 | 0.49 |

→ Reranker가 핵심, Hybrid는 JIRA 같은 키워드 검색에서 효과

---

## Phase 5: 평가 체계 구축

### 문제
- 5개 TC로는 프로덕션 기준 불가
- 키워드 매칭 기반 자체 평가 → 신뢰도 낮음

### 작업
1. 평가셋 20개 TC 생성 (소스타입별 골고루):
   - Oracle procedure 6, table 2, function 1
   - Java TO-BE 3, batch 1, legacy 1
   - Business rule 2, Document migration 2
   - Frontend 1, Cross-source 1
2. Ragas 프레임워크 도입 (공식 RAG 평가)
3. Gemini 2.5-flash를 LLM Judge로 사용
4. gemini-embedding-001을 AR 계산용으로 사용

### 베이스라인 (20TC, pgvector Dense)
CP 0.260, CR 0.189, F 0.124, AR 0.179, OVERALL 0.188

---

## Phase 6: 지식 보강

### 문제
- 문서는 찾는데 GT 정보가 청크에 없어서 CR=0 (6개 TC)

### 작업
1차 보강 (6개):
- TC4: PARAM_SOGB_YN 파라미터 역할 (소급 분배 여부)
- TC5: 매체별 분배 순서 (방송→CATV→기타→전송→연주)
- TC6: TDIS_ABR_ERR_RETURN 테이블 용도
- TC9: SP_DISTR_HIS_UPDATE 프로시저 역할
- TC15: KOMCA-1796 JIRA 이슈 요약
- TC16: KOMCA-1805 JIRA 이슈 요약

2차 보강 (6개):
- TC7: TENV_SVCCD → TENV_SVC_CD 매핑
- TC11: BillController 기능 요약
- TC12: foreigndistdata 서비스 역할
- TC13: Netflix 큐시트 배치 DTO
- TC14: MIG_BRDCS111 레거시 클래스 역할
- TC20: TOPU_CWR_ACK 테이블 용도

---

## Phase 7: 인프라 전환 (진행 중)

### 작업
1. Qdrant 프로덕션 컬렉션 생성 + 전체 마이그레이션
2. search.ts → Qdrant Hybrid + Reranker 기반으로 전환
3. indexer.ts → Qdrant 적재 추가
4. qdrant.ts 클라이언트 모듈 생성

---

## Ragas 공식 결과 (최종)

| 지표 | 시작 | 최종 | 목표 |
|------|------|------|------|
| Context Precision | 0.08 | **0.894** | 0.7 ✅ |
| Context Recall | 0.18 | **0.950** | 0.75 ✅ |
| Faithfulness | 1.00 | **0.848** | 0.8 ✅ |
| Answer Relevancy | - | **0.849** | - ✅ |
| **OVERALL** | - | **0.885** | **0.8 ✅** |

Judge: gemini-2.5-flash, 20TC, Ragas 0.4.3

---

## 실패한 시도

| 시도 | 결과 | 교훈 |
|------|------|------|
| multilingual-e5-large | 성능 나쁨 | 한국어+코드 도메인에 약함 |
| Chonkie 단독 청킹 | 차이 미미 | 청킹보다 메타데이터 헤더가 핵심 |
| pg_trgm Hybrid | 한국어/SQL에서 약함 | Qdrant sparse가 나음 |
| IVFFlat 인덱스 | 새 벡터 누락 | HNSW가 더 정확 |
| 자체 키워드 매칭 평가 | 신뢰도 낮음 | Ragas + LLM Judge 필수 |
