# Comb Engine

팀용 RAG 인프라 서비스입니다. 다양한 소스에서 데이터를 수집하고, 청킹/요약/임베딩을 거쳐 Qdrant 기반 검색 API를 제공합니다.

## 역할

- 데이터 수집: Git clone, 웹, 문서, DB, 캘린더 등
- 처리 파이프라인: 요약, 청킹, 임베딩, 인덱싱
- 검색 API: hybrid search + reranker
- 외부 연동: `comb-hub`, `@side/comb-client`

## 현재 기준 이름

- 로컬 기준 디렉터리: `comb-engine`
- 서비스 이름: `comb-engine`
- 과거 이름: `comb-engine`
- 참고: 일부 원격/문서 자산에는 과거 이름이 남아 있을 수 있습니다.

## 주요 명령어

```bash
pnpm install
pnpm dev
pnpm build
pnpm db:generate
pnpm db:push
pnpm test
```

## 개발 서버

- Port: `11009`

## 핵심 문서

- 운영/구성: `CLAUDE.md`
- 품질 개선 이력: `docs/RAG_QUALITY_IMPROVEMENT.md`
- 작업 backlog: `docs/TODO.md`

## 스택

- Next.js 15
- TypeScript
- Prisma
- Qdrant
- Ollama bge-m3
- Gemini embedding-002
- NextAuth
