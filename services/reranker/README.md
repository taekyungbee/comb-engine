# services/reranker — bge-reranker-v2-m3 (FastAPI)

comb-engine 검색 파이프라인의 마지막 단계(`src/lib/rag/search.ts` `rerank()`)가 호출하는 재순위 서비스.
Gitea `geng/rag-reranker` 저장소를 이 디렉터리로 흡수했다(LAZ-780, PLAN.md Phase 7-3). 이후 코드 기준은 여기다.

- `POST /rerank` `{ query, documents[], top_k }` → `{ results: [{ index, score, document }] }` (문서는 2000자에서 자름)
- `GET /health` → `{ status: "ok", model: "bge-reranker-v2-m3" }`
- 포트 10800, 비루트(`nonroot`) 실행, 모델은 이미지 빌드 때 내려받는다(이미지 ~3GB, CPU torch)

## 배포 (Coolify, dev-server)

| 항목 | 값 |
|---|---|
| 앱 | `comb-reranker` (GitHub `taekyungbee/comb-engine` `main`, build pack dockerfile) |
| Base directory | `/services/reranker` · Dockerfile `/services/reranker/Dockerfile` |
| 포트 | `10800:10800` |
| comb-engine env | `RERANKER_URL=http://192.168.0.67:10800` (없으면 `http://localhost:10800` → 컨테이너 안에서 실패 → hybrid 점수 폴백) |

옛 Coolify 앱 `rag-reranker`(uuid `reranker00000000000000rk`, Gitea `geng/rag-reranker`)는 exited 상태로 두었다가
`comb-reranker` 가 healthy 이고 comb-engine `RERANKER_URL` 이 새 앱을 가리키면 삭제한다(PLAN.md Phase 8).

## 로컬 실행

```bash
cd services/reranker
docker build -t comb-reranker .
docker run --rm -p 10800:10800 comb-reranker
curl -s localhost:10800/health
```
