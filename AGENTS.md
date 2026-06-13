<!-- project-wiki:auto-generated -->
# AGENTS.md - comb-engine

이 파일은 `projects/lazy/comb-engine`와 그 하위 경로에 적용되는 프로젝트 지침입니다. 실제 파일 분석 기준으로 자동 갱신되었습니다.

## 프로젝트 요약

- 이름: comb-engine
- 경로: `projects/lazy/comb-engine`
- 분류: 사이드 프로젝트
- 목적 단서: Comb Engine - 팀용 RAG 인프라 서비스입니다. 다양한 소스에서 데이터를 수집하고, 청킹/요약/임베딩을 거쳐 Qdrant 기반 검색 API를 제공합니다.
- 주요 스택: Node.js, Next.js ^15.2.0, React ^19.0.0, Prisma, Tailwind CSS, TypeScript ^5.7.0, Vitest, Docker, Prisma schema
- 패키지 매니저: pnpm
- 위키: `wiki/`

## 실제 파일 기반 지침

### 분석된 구조 신호

- 스캔 파일 수: 121
- 주요 확장자: ts:78, md:7, js:3, config:2, python:2
- 상위 항목:
- `AGENTS.md`
- `CLAUDE.md`
- `docker-compose.yml`
- `Dockerfile`
- `docs/`
- `eslint.config.js`
- `next-env.d.ts`
- `next.config.js`
- `package.json`
- `pnpm-lock.yaml`
- `postcss.config.js`
- `prisma/`
- `public/`
- `README.md`
- `scripts/`
- `services/`
- `src/`
- `tsconfig.json`
- `tsconfig.tsbuildinfo`
- `validate.config.json`

### 주요 실제 파일

- `README.md`
- `package.json`
- `tsconfig.json`
- `next.config.js`
- `prisma/schema.prisma`
- `Dockerfile`
- `docker-compose.yml`
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/app/page.tsx`

### 소스와 테스트 위치

- `src/`
- `services/`
- `prisma/`
- `docs/`
- `scripts/`
- `src/app/`

### 실행과 검증 명령

- `pnpm dev`
- `pnpm build`
- `pnpm lint`
- `pnpm type-check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:unit`
- `pnpm validate`
- `pnpm db:generate`
- `pnpm db:push`
- `docker compose up`

### 패키지 스크립트

- dev: next dev -p 11009
- build: next build
- start: next start -p 11009
- lint: next lint
- type-check: tsc --noEmit
- db:push: prisma db push
- db:generate: prisma generate
- db:studio: prisma studio
- batch:embed: npx tsx scripts/batch-embed.ts
- batch:summarize: npx tsx scripts/batch-summarize.ts
- migrate:ohub: npx tsx scripts/migrate-ohub.ts
- chunk:missing: npx tsx scripts/chunk-missing.ts
- lint:fix: eslint src --fix
- typecheck: tsc --noEmit
- test:unit: vitest run
- test: vitest run

### 환경과 배포 단서

- `docker-compose.yml`

## 작업 원칙

- 변경 전 위의 주요 실제 파일과 관련 README, 설정 파일, 기존 위키를 먼저 확인한다.
- 새 의존성은 꼭 필요할 때만 추가하고 기존 도구와 스크립트를 우선 사용한다.
- 민감 정보는 커밋하지 않는다. 실제 키와 비밀번호는 환경 변수나 로컬 설정으로 둔다.
- 산출물과 설치 폴더는 수정 대상으로 보지 않는다. 예: `node_modules`, `.next`, `target`, `build`, `dist`.
- 변경 뒤에는 가장 가까운 검증 명령을 실행하고 결과를 위키 작업 기록에 남긴다.

## 프로젝트별 주의사항

- 프론트엔드 변경 전 기존 컴포넌트, 라우트, 스타일 설정을 먼저 확인한다.
- 화면 변경은 가능한 경우 빌드나 타입 검사 뒤 브라우저로 주요 화면을 확인한다.
- 타입을 약하게 만들지 말고 기존 경로 별칭과 모듈 경계를 따른다.
- Prisma 스키마 변경 시 생성, 마이그레이션, 관련 API 영향을 함께 확인한다.
- Python 변경은 가상환경, pyproject 설정, pytest 기준을 따른다.
- Docker나 compose 변경은 포트, 볼륨, 환경 변수의 운영 영향을 함께 기록한다.
- 상위 `projects/lazy/AGENTS.md`의 스타일, 검증, 보안 지침을 함께 따른다.

## 위키 운영

- 옵시디언 볼트는 `wiki/`이다.
- 시작 문서는 `wiki/Home.md`이다.
- 프로젝트 판단, 운영 메모, 작업 기록은 위키에 남긴다.
- 구조, 실행 방법, 배포 방식이 바뀌면 이 지침과 `wiki/구조 지도.md`를 함께 갱신한다.
