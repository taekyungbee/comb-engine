import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 공개 경로
  const publicPaths = ['/login', '/api/auth'];
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // 정적 파일
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return NextResponse.next();
  }

  // API Key 헤더가 있으면 미들웨어 패스 (route handler에서 인증 검증)
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('ApiKey ') && pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // 세션 쿠키 확인
  const sessionToken =
    request.cookies.get('authjs.session-token')?.value ||
    request.cookies.get('__Secure-authjs.session-token')?.value;

  if (!sessionToken) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
