# rag-collector + outsource-hub 작업 목록

## rag-collector 작업

### 1. Git clone 수집기
- 현재: 로컬 경로 기반 (`/home/user/komca-source/src`)
- 변경: Git URL 입력 → `git clone` → 분석 → 정리
- 소스 연결 시 Git 주소만 넣으면 되도록

### 2. PPT 멀티모달 수집
- 현재: PPT 텍스트 추출 → 쓰레기 데이터 ("공연 - 무대공연" 수준)
- 변경: PPT → 슬라이드별 이미지 변환 → Gemini 멀티모달 분석/요약
- 화면설계서의 레이아웃, 테이블, 다이어그램 내용을 제대로 추출
- outsource-hub KOMCA 기준 437건 슬라이드 문서 존재

### 3. summarizer 이관
- outsource-hub의 `src/services/summarizer.ts` → rag-collector로 이동
- 모델: `gemini-3.1-flash-lite-preview` (배치/자동 요약)
- 수집 시 V0 → 바로 V1 요약 생성 → 임베딩 1회로 끝내기

### 4. 수집 파이프라인 통합
- 순서: 수집 → Knowledge 엔티티 생성 → AI 요약(V1) → 임베딩
- 임베딩은 V1 완료 후 1회만 (현재는 V0 임베딩 → V1 후 재임베딩으로 2회)
- Gemini API: embedding은 `gemini-embedding-2-preview` (3072차원)

### 5. MCP 구조 정리 ✅
- MCP 서버는 outsource-hub에 유지 (도메인 있음, 팀원 접근)
- outsource-hub MCP에 RAG 툴 추가 (search, ingest → rag-collector 내부 API 호출)
- rag-collector는 순수 API 서비스 (MCP 없음, 내부 IP만)

### 6. 쓰레기 데이터 필터링
- content 10자 미만 엔티티 수집 단계에서 제외
- 빈 PPT 슬라이드 (제목없음 + 내용 한 줄) 필터링
- DTO/VO 등 로직 없는 단순 클래스는 요약 생략 or 간소화

---

## outsource-hub 작업

### 1. 배포
- Coolify 수동 배포 (API 토큰 만료됨, 갱신 필요)
- 대시보드: http://192.168.0.67:8000
- 앱 UUID: u88s4s0kcwwwcw4wkgcccwg0

### 2. 비교분석 재생성
- 기존 973건이 로컬 LLM(gemma/qwen)으로 생성 → 품질 낮음
- Gemini 3.1 Pro로 재분석 필요
- TODO, 깨진 마크다운 테이블 등 개선

### 3. 실패 문서 121건 재적재
- doc reembed 시 400 에러 (Gemini 임베딩 8192 토큰 초과)
- 청크 크기 줄여서 재시도

### 4. Qdrant 정리
- `outsource-hub` 컬렉션 324,612건 — 용도 확인 후 삭제
- `komca` 컬렉션: 114,920 벡터 (3072차원, 정상)

### 5. Coolify API 토큰 갱신
- 현재 토큰 `s4oc0cgc44w4o0owg4wcg0g00ow4k0408co4go0c` 만료

---

## Gemini API 모델 정리

| 용도 | 모델명 | 가격 (1M 토큰) |
|------|--------|---------------|
| 챗봇/비교분석/산출물 | `gemini-3.1-pro-preview` | $1.25 / $10.00 |
| 요약 배치 | `gemini-3.1-flash-lite-preview` | $0.25 / $1.50 |
| 임베딩 | `gemini-embedding-2-preview` | $0.006 |

## 인프라 현황

- **Gemini API**: Tier 1 (RPM 150~300)
- **Qdrant**: 192.168.0.67:6333 (komca 컬렉션 3072차원)
- **Ollama**: 192.168.0.81:11434 (폴백용, gemma3:27b/12b)
- **DB**: PostgreSQL 192.168.0.67:5433
