import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, requireRole, AuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await authenticateRequest(request);
    if (!user) {
      // 비인증: public 컬렉션만
      const collections = await prisma.collection.findMany({
        where: { visibility: 'PUBLIC' },
        include: { owner: { select: { name: true } }, _count: { select: { documents: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return NextResponse.json({ success: true, data: collections });
    }

    // 인증 사용자: 자기 컬렉션 + shared + public
    const collections = await prisma.collection.findMany({
      where: {
        OR: [
          { ownerId: user.userId },
          { visibility: 'SHARED' },
          { visibility: 'PUBLIC' },
        ],
      },
      include: { owner: { select: { name: true } }, _count: { select: { documents: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, data: collections });
  } catch (error) {
    console.error('List collections error:', error);
    return NextResponse.json(
      { success: false, error: { message: '오류가 발생했습니다.', code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = requireRole(await authenticateRequest(request), 'ADMIN', 'MEMBER');
    const { name, description, visibility } = await request.json();

    if (!name) {
      return NextResponse.json(
        { success: false, error: { message: '컬렉션 이름이 필요합니다.', code: 'MISSING_FIELDS' } },
        { status: 400 }
      );
    }

    const collection = await prisma.collection.create({
      data: {
        name,
        description,
        visibility: visibility || 'PRIVATE',
        ownerId: user.userId,
      },
      include: { owner: { select: { name: true } } },
    });

    return NextResponse.json({ success: true, data: collection }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: { message: error.message, code: 'AUTH_ERROR' } },
        { status: error.statusCode }
      );
    }
    console.error('Create collection error:', error);
    return NextResponse.json(
      { success: false, error: { message: '오류가 발생했습니다.', code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}
