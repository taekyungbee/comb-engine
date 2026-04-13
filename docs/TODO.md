# comb-engine 작업 목록

## 역할 정의

```
comb-engine (192.168.0.67:11009, 내부 전용)
├── 데이터 수집 (12종 수집기 + cron 스케줄)
├── AI 요약 (gemini-3.1-flash-lite-preview)
├── 임베딩 (gemini-embedding-2-preview, 3072차원)
├── 벡터 저장/검색 (pgvector)
└── API: /api/ingest, /api/search, /api/stats

[DISCONTINUED - comb-hub is no longer a separate project]
```

## 현황 (2026-03-17)

### comb-engine (comb_engine DB)

- 문서: 149,820건 | 청크: 350,402건 (전부 임베딩 완료)
- 소스: 57개 (KOMCA Git 50 + 테스트 7)
- Qdrant → pgvector 마이그레이션 완료 (115,636건)
- PPT 멀티모달 수집 완료 (419장 Gemini Vision)

[DISCONTINUED - comb-hub is no longer a separate project]

### 불일치 문제

1. **comb-engine 검색이 Qdrant 의존** — comb-engine pgvector로 전환 필요
2. **portfolio_rag.document_chunks = 0건** — 청크가 Qdrant에만 있었음 (comb-hub 관련)
3. **데이터 중복** — portfolio_rag 16,339건 + comb_engine 149,820건 (일부 겹침) (comb-hub 관련)
4. **대시보드 0건 표시** — 소스별 문서 수가 기준이라 comb-engine 데이터 미반영

---

## 완료된 작업 ✅

### 1. Git clone 수집기 ✅

### 2. PPT 멀티모달 수집 ✅

### 3. summarizer 이관 ✅

### 4. 수집 파이프라인 통합 ✅ (배치 모드 기본)

### 5. MCP 구조 정리 ✅

### 6. 쓰레기 데이터 필터링 ✅

### 7. Qdrant → pgvector 마이그레이션 ✅

### 8. KOMCA 초기 적재 ✅ (50개 레포, 33,755건)

### 9. 배치 스크립트 ✅ (summarize, embed, sync-embed, migrate-qdrant, ppt-multimodal)

---

## 남은 작업

### 1. 프로젝트 모델 + 자동 등록/스케줄

- 프로젝트 생성 시 GitHub 조직 / 파일 디렉토리 일괄 등록
- 소스 자동 등록 + cron 스케줄 자동 설정
- 초기 적재 자동 파이프라인 (수집 → 배치 요약 → 임베딩)
- 프로젝트 단위 관리 vs 개인 인사이트 구분

### 2. [DISCONTINUED - comb-hub is no longer a separate project]

- comb-hub 검색을 Qdrant → comb-engine API로 전환
- `src/services/search.service.ts`: Qdrant → comb-engine `/api/search` 호출
- `src/lib/qdrant.ts` 제거
- 대시보드에서 comb-engine 통계 표시

### 3. [DISCONTINUED - comb-hub is no longer a separate project]

- portfolio_rag의 documents 16,339건 중 comb_engine에 없는 것 이관
- 비교분석(comparisons) 973건은 comb-engine 고유 → 유지
- data_sources 15개 → comb-engine collector_sources로 매핑

### 4. Qdrant 컨테이너 제거

- comb-hub 검색 전환 완료 후
- Qdrant 컨테이너 정지 및 제거
- 메모리 확보

### 5. 비교분석 재생성

- 기존 973건: 로컬 LLM(gemma/qwen)으로 생성 → 품질 낮음
- Gemini 3.1 Pro로 재분석 필요

### 6. Docker 네트워크 영구 설정

- rag-pgvector를 coolify 네트워크에 영구 연결
- 컨테이너 재시작 시 연결 끊김 방지

---

## Gemini API 모델 정리

| 용도            | 모델명                          | 가격 (1M 토큰) | 사용처         |
| --------------- | ------------------------------- | -------------- | -------------- |
| 비교분석/산출물 | `gemini-3.1-pro-preview`        | $1.25 / $10.00 | [DISCONTINUED] |
| 요약 배치       | `gemini-3.1-flash-lite-preview` | $0.25 / $1.50  | comb-engine    |
| 임베딩          | `gemini-embedding-2-preview`    | $0.006         | comb-engine    |
