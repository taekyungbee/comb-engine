# Next.js Fullstack Template

Next.js 14 기반의 풀스택 웹 애플리케이션 템플릿입니다.

## 기술 스택

| 영역 | 기술 |
|------|------|
| **프레임워크** | Next.js 14.x (App Router) |
| **언어** | TypeScript 5.x (strict mode) |
| **스타일링** | TailwindCSS 3.x |
| **ORM** | Prisma |
| **데이터베이스** | PostgreSQL 16 |
| **패키지 매니저** | pnpm |
| **컨테이너** | Docker |

## 프로젝트 구조

```
nextjs-fullstack/
├── prisma/                 # Prisma 스키마 및 마이그레이션
│   └── schema.prisma
├── src/
│   ├── app/               # Next.js App Router
│   │   ├── api/           # API Routes
│   │   │   └── hello/     # Hello CRUD API
│   │   ├── layout.tsx     # 루트 레이아웃
│   │   ├── page.tsx       # 메인 페이지
│   │   └── globals.css    # 전역 스타일
│   ├── components/        # React 컴포넌트
│   │   ├── ui/            # UI 컴포넌트 (Button 등)
│   │   └── HelloWorld.tsx # 예시 컴포넌트
│   ├── lib/               # 유틸리티 및 설정
│   │   ├── prisma.ts      # Prisma 클라이언트
│   │   └── utils.ts       # 공용 유틸리티
│   ├── services/          # 비즈니스 로직
│   │   └── hello.service.ts
│   └── types/             # TypeScript 타입 정의
│       └── hello.ts
├── Dockerfile             # Docker 이미지 빌드
├── docker-compose.yml     # Docker Compose 설정
├── next.config.js         # Next.js 설정
├── tailwind.config.ts     # TailwindCSS 설정
└── tsconfig.json          # TypeScript 설정
```

## 시작하기

### 사전 요구사항

- Node.js 18.17.0 이상
- pnpm 8.x 이상
- PostgreSQL 16 (또는 Docker)

### 로컬 개발 환경

#### 1. 의존성 설치

```bash
pnpm install
```

#### 2. 환경 변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열어 데이터베이스 연결 정보를 설정합니다:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/nextjs_fullstack?schema=public"
```

#### 3. 데이터베이스 설정

```bash
# Prisma 클라이언트 생성
pnpm db:generate

# 스키마를 데이터베이스에 반영
pnpm db:push
```

#### 4. 개발 서버 실행

```bash
pnpm dev
```

브라우저에서 http://localhost:10011 접속

### Docker 환경

#### Docker Compose로 실행

```bash
# 빌드 및 실행
docker-compose up -d

# 로그 확인
docker-compose logs -f app

# 종료
docker-compose down
```

#### 개발 모드로 실행 (핫 리로드)

```bash
docker-compose --profile dev up
```

## 주요 명령어

| 명령어 | 설명 |
|--------|------|
| `pnpm dev` | 개발 서버 실행 (포트: 10011) |
| `pnpm build` | 프로덕션 빌드 |
| `pnpm start` | 프로덕션 서버 실행 |
| `pnpm lint` | ESLint 검사 |
| `pnpm db:generate` | Prisma 클라이언트 생성 |
| `pnpm db:push` | 스키마를 DB에 반영 |
| `pnpm db:migrate` | 마이그레이션 실행 |
| `pnpm db:studio` | Prisma Studio 실행 |

## API 엔드포인트

### Hello API

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| `GET` | `/api/hello` | 전체 목록 조회 |
| `POST` | `/api/hello` | 새로운 Hello 생성 |
| `GET` | `/api/hello/:id` | 특정 Hello 조회 |
| `PUT` | `/api/hello/:id` | Hello 수정 |
| `DELETE` | `/api/hello/:id` | Hello 삭제 |

### 요청/응답 예시

#### 목록 조회

```bash
curl http://localhost:10011/api/hello
```

응답:
```json
{
  "success": true,
  "message": "Hello 목록 조회 성공",
  "data": {
    "data": [
      {
        "id": "clxx...",
        "message": "안녕하세요!",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "total": 1
  }
}
```

#### 생성

```bash
curl -X POST http://localhost:10011/api/hello \
  -H "Content-Type: application/json" \
  -d '{"message": "안녕하세요!"}'
```

## 환경 변수

| 변수명 | 설명 | 기본값 |
|--------|------|--------|
| `NODE_ENV` | 실행 환경 | `development` |
| `DATABASE_URL` | PostgreSQL 연결 URL | - |
| `NEXT_PUBLIC_APP_URL` | 애플리케이션 URL | `http://localhost:10011` |

## 배포

### Coolify를 사용한 배포

1. Coolify 대시보드에서 새 프로젝트 생성
2. Git 저장소 연결
3. 환경 변수 설정 (DATABASE_URL 등)
4. 빌드 팩: Dockerfile 선택
5. 포트: 10011 설정
6. 배포 실행

### 수동 Docker 배포

```bash
# 이미지 빌드
docker build -t nextjs-fullstack .

# 컨테이너 실행
docker run -d \
  -p 10011:10011 \
  -e DATABASE_URL="postgresql://..." \
  --name nextjs-fullstack-app \
  nextjs-fullstack
```

## 라이선스

MIT License

---

Created by LazyBee
