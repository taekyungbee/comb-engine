import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const authUser = await authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json(
        { success: false, error: { message: '인증이 필요합니다.', code: 'UNAUTHORIZED' } },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.userId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    return NextResponse.json({ success: true, data: user });
  } catch (error) {
    console.error('Get me error:', error);
    return NextResponse.json(
      { success: false, error: { message: '사용자 조회 중 오류가 발생했습니다.', code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}
