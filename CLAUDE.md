# CLAUDE.md - Next.js Fullstack Template

## 프로젝트 개요

Next.js 14 App Router 기반의 풀스택 웹 애플리케이션 템플릿입니다.
TypeScript strict mode, Prisma ORM, TailwindCSS를 사용합니다.

## 기술 스택

- **프레임워크**: Next.js 14.x (App Router)
- **언어**: TypeScript 5.x (strict mode)
- **스타일링**: TailwindCSS 3.x
- **ORM**: Prisma
- **데이터베이스**: PostgreSQL 16
- **패키지 매니저**: pnpm

## 주요 명령어

```bash
pnpm install       # 의존성 설치
pnpm dev           # 개발 서버 (포트: 10011)
pnpm build         # 프로덕션 빌드
pnpm db:generate   # Prisma 클라이언트 생성
pnpm db:push       # 스키마 DB 반영
pnpm db:studio     # Prisma Studio
```

## 프로젝트 구조

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API Routes
│   ├── layout.tsx         # 루트 레이아웃
│   └── page.tsx           # 페이지
├── components/            # React 컴포넌트
│   └── ui/                # 공통 UI 컴포넌트
├── lib/                   # 유틸리티
├── services/              # 비즈니스 로직
└── types/                 # TypeScript 타입
```

## AI 작업 지침

### 코드 스타일

1. **TypeScript strict mode 준수**
   - 모든 타입을 명시적으로 정의
   - `any` 사용 금지, `unknown` 사용 권장
   - 인터페이스는 `types/` 디렉토리에 정의

2. **컴포넌트 작성 규칙**
   - 함수형 컴포넌트만 사용
   - 클라이언트 컴포넌트는 `'use client'` 명시
   - Props 타입은 인터페이스로 정의

3. **파일 명명 규칙**
   - 컴포넌트: PascalCase (`Button.tsx`)
   - 유틸리티: camelCase (`utils.ts`)
   - 타입 정의: camelCase (`hello.ts`)

### Next.js App Router API Routes 패턴

#### 기본 구조

```typescript
// src/app/api/[resource]/route.ts
import { NextRequest, NextResponse } from 'next/server';

// GET - 목록 조회
export async function GET() {
  try {
    const data = await Service.findAll();
    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { message: '서버 오류', code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}

// POST - 생성
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // 유효성 검사
    if (!body.field) {
      return NextResponse.json(
        { success: false, error: { message: '필수 필드 누락', code: 'VALIDATION_ERROR' } },
        { status: 400 }
      );
    }
    const data = await Service.create(body);
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { message: '서버 오류', code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}
```

#### 동적 라우트 (ID 기반)

```typescript
// src/app/api/[resource]/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';

type RouteParams = {
  params: Promise<{ id: string }>;
};

// GET - 단일 조회
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const data = await Service.findById(id);

  if (!data) {
    return NextResponse.json(
      { success: false, error: { message: '리소스를 찾을 수 없습니다', code: 'NOT_FOUND' } },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data }, { status: 200 });
}

// PUT - 수정
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json();
  const data = await Service.update(id, body);

  if (!data) {
    return NextResponse.json(
      { success: false, error: { message: '리소스를 찾을 수 없습니다', code: 'NOT_FOUND' } },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data }, { status: 200 });
}

// DELETE - 삭제
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const deleted = await Service.delete(id);

  if (!deleted) {
    return NextResponse.json(
      { success: false, error: { message: '리소스를 찾을 수 없습니다', code: 'NOT_FOUND' } },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: null }, { status: 200 });
}
```

### 응답 포맷

```typescript
// 성공 응답
{
  "success": true,
  "message": "성공 메시지",
  "data": { ... }
}

// 에러 응답
{
  "success": false,
  "error": {
    "message": "에러 메시지",
    "code": "ERROR_CODE"
  }
}
```

### 에러 코드

| 코드 | HTTP 상태 | 설명 |
|------|----------|------|
| `VALIDATION_ERROR` | 400 | 유효성 검사 실패 |
| `UNAUTHORIZED` | 401 | 인증 필요 |
| `FORBIDDEN` | 403 | 권한 없음 |
| `NOT_FOUND` | 404 | 리소스 없음 |
| `INTERNAL_ERROR` | 500 | 서버 내부 오류 |

### 서비스 레이어 패턴

```typescript
// src/services/example.service.ts
import prisma from '@/lib/prisma';

export class ExampleService {
  static async findAll() {
    return prisma.example.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  static async findById(id: string) {
    return prisma.example.findUnique({
      where: { id },
    });
  }

  static async create(data: CreateExampleRequest) {
    return prisma.example.create({ data });
  }

  static async update(id: string, data: UpdateExampleRequest) {
    try {
      return await prisma.example.update({
        where: { id },
        data,
      });
    } catch {
      return null;
    }
  }

  static async delete(id: string) {
    try {
      await prisma.example.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}
```

### Prisma 스키마 작성 규칙

```prisma
model Example {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("examples")  // 테이블명은 snake_case 복수형
}
```

### 새로운 리소스 추가 체크리스트

1. [ ] `prisma/schema.prisma`에 모델 추가
2. [ ] `pnpm db:push`로 스키마 반영
3. [ ] `src/types/[resource].ts` 타입 정의
4. [ ] `src/services/[resource].service.ts` 서비스 작성
5. [ ] `src/app/api/[resource]/route.ts` API Route 작성
6. [ ] `src/app/api/[resource]/[id]/route.ts` 동적 Route 작성
7. [ ] 필요시 컴포넌트 및 페이지 추가

## 외부 연동

- **Git**: Gitea (https://gitea.lazybee.io)
- **배포**: Coolify (https://coolify.lazybee.io)
- **이슈**: Linear

## 포트

- 개발/프로덕션: **10011**
