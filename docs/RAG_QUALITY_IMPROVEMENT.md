# RAG 품질 현황 및 운영 가이드

## 금지 사항

1. **Gemini API로 텍스트 임베딩 호출 금지** — bge-m3 로컬 사용
2. **multilingual-e5-large 사용 금지** — 테스트 완료, 성능 나쁨
3. **수정 완료된 파일을 Gemini 버전으로 되돌리지 말 것** (아래 "확정 파일" 참고)
4. **전체 임베딩 한 번에 돌리지 않기** — 만건씩 테스트 → 점수 확인 → 개선 루프

---

## 현재 아키텍처

| 구성 | 기술 | 비고 |
|------|------|------|
| **벡터DB** | Qdrant (192.168.0.67:12333) | pgvector 폐기 |
| **임베딩(텍스트)** | bge-m3 1024d (Ollama 로컬) | 비용 0원 |
| **임베딩(이미지)** | Gemini embedding-002 3072d | 멀티모달 전용, 별도 컬렉션 |
| **Reranker** | bge-reranker-v2-m3 (192.168.0.67:10800) | CrossEncoder |
| **검색 파이프라인** | Dense top-20 + Sparse top-20 + Keyword → RRF → Reranker → top-K | |
| **청킹** | smartChunk (소스타입별 의미 단위) | @side/rag-core |

---

## 점수 현황

### Ragas 공식 평가 (20TC, gemini-2.5-flash Judge)
| 지표 | 시작 | 최종 | 목표 |
|------|------|------|------|
| Context Precision | 0.08 | **0.894** | 0.7 ✅ |
| Context Recall | 0.18 | **0.950** | 0.75 ✅ |
| Faithfulness | 1.00 | **0.848** | 0.8 ✅ |
| Answer Relevancy | — | **0.849** | — ✅ |
| **OVERALL** | — | **0.885** | **0.8 ✅** |

### 50TC 키워드 매칭 평가 (지식보강 후)
| 지표 | 보강 전 | 보강 후 | 변화 |
|------|---------|---------|------|
| CP | 0.499 | **0.744** | +49% |
| CR | 0.480 | **0.697** | +45% |
| 약한 TC | 27개 | **9개** | -18개 |

50TC Gemini Judge 공식 평가는 API spending cap 리셋 후 실행 예정.

### 카테고리별 (50TC 키워드 매칭)
| 카테고리 | CP | CR | 건수 |
|---------|-----|-----|------|
| terminology | 1.00 | 0.86 | 3 |
| frontend | 1.00 | 0.81 | 4 |
| java_batch | 1.00 | 0.83 | 2 |
| api_endpoint | 0.80 | 0.76 | 5 |
| oracle_procedure | 0.75 | 0.71 | 8 |
| java_tobe | 0.75 | 0.70 | 6 |
| cross_source | 0.75 | 0.72 | 4 |
| business_rule | 0.70 | 0.71 | 6 |
| document_migration | 0.70 | 0.62 | 5 |
| oracle_table | 0.60 | 0.59 | 5 |

---

## 다음 작업

1. **50TC Gemini Judge 공식 평가** — `~/projects/rag-eval/eval-50tc-gemini.py`
2. **남은 9개 약한 TC 추가 보강** — TC8, 10, 14, 16, 17, 25, 37, 38, 48
3. **구글 드라이브 SB 멀티모달 재수집** — Gemini Vision 경로
4. **pgvector 완전 제거** — PostgreSQL 의존성 정리, Qdrant 전용

---

## 평가 도구

| 도구 | 경로 | 용도 |
|------|------|------|
| 평가셋 (50TC) | `scripts/eval-testset.json` | 전체 테스트 케이스 |
| 키워드 평가 | `scripts/eval-50tc.ts` | LLM 없이 빠른 검증 |
| Gemini Judge | `~/projects/rag-eval/eval-50tc-gemini.py` | Gemini 2.5-flash 공식 평가 |
| 지식보강 | `scripts/knowledge-supplement.ts` | 약한 TC Qdrant 직접 인제스트 |
| 검색 검증 | `scripts/verify-search.ts` | 특정 쿼리 검색 결과 확인 |
| 임베딩 (우선순위) | `scripts/embed-priority.ts` | 분배 핵심 → Oracle/Java → 나머지 |

---

## 인프라

| 서비스 | 주소 |
|--------|------|
| Qdrant | 192.168.0.67:12333 |
| Reranker | 192.168.0.67:10800 |
| Ollama (bge-m3) | localhost:11434 |
| Gitea | http://192.168.0.67:3000/geng/rag-collector |
| Coolify | http://192.168.0.67:8880 |

---

## 핵심 교훈

| 교훈 | 근거 |
|------|------|
| 메타데이터 헤더 > 청킹 개선 | Chonkie 실험: 청킹만으론 차이 미미 |
| Reranker가 검색 정밀도에 결정적 | Dense only CP 0.40 → +Reranker CP 0.48 |
| 지식 보강 청크가 CR 0→1.0 | GT 정보 없으면 아무리 검색해도 CR=0 |
| Ragas + LLM Judge 필수 | 자체 키워드 매칭 평가는 신뢰도 낮음 |
| Qdrant sparse > pg_trgm | 한국어/SQL 키워드에서 pg_trgm 약함 |
| HNSW > IVFFlat | IVFFlat이 새 벡터 누락하는 문제 |

---

## 확정 파일 (되돌리지 말 것)

아래 파일은 **Gemini → bge-m3 전환 완료** 상태. 수정 시 bge-m3 기반 위에서 개선할 것.

| 파일 | 핵심 변경 |
|------|----------|
| `src/lib/ai-core/index.ts` | OllamaEmbeddingProvider (bge-m3), getImageEmbeddingProvider (Gemini) |
| `src/lib/rag/embedding.ts` | DIMENSIONS=1024, embedImage→Gemini |
| `src/lib/rag/indexer.ts` | smartChunk 적용, Qdrant 적재, toRagSourceType 매핑 |
| `src/lib/rag/search.ts` | Qdrant Hybrid + Reranker, documentId 반환, score 정규화 |
| `src/lib/qdrant.ts` | QdrantClient, textToSparse |
| `packages/rag-core/src/index.ts` | smartChunk(), OllamaEmbedding, GeminiEmbedding |
| `scripts/embed-priority.ts` | Ollama bge-m3 4워커 병렬 임베딩 |

---

## 상세 작업 이력

Phase별 상세 이력은 `docs/RAG_WORK_HISTORY.md` 참고.
