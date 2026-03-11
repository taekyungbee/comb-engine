import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, requireRole, AuthError } from '@/lib/auth';

type RouteParams = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(await authenticateRequest(request), 'ADMIN', 'MEMBER');
    const { id } = await params;

    const apiKey = await prisma.apiKey.findUnique({ where: { id } });
    if (!apiKey || apiKey.userId !== user.userId) {
      return NextResponse.json(
        { success: false, error: { message: 'API Key를 찾을 수 없습니다.', code: 'NOT_FOUND' } },
        { status: 404 }
      );
    }

    await prisma.apiKey.delete({ where: { id } });

    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: { message: error.message, code: 'AUTH_ERROR' } },
        { status: error.statusCode }
      );
    }
    console.error('Delete API key error:', error);
    return NextResponse.json(
      { success: false, error: { message: '오류가 발생했습니다.', code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}
