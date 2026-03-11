import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, requireRole, AuthError } from '@/lib/auth';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const user = await authenticateRequest(request);

    const collection = await prisma.collection.findUnique({
      where: { id },
      include: { owner: { select: { name: true } }, _count: { select: { documents: true } } },
    });

    if (!collection) {
      return NextResponse.json(
        { success: false, error: { message: '컬렉션을 찾을 수 없습니다.', code: 'NOT_FOUND' } },
        { status: 404 }
      );
    }

    // 접근 권한 확인
    if (collection.visibility === 'PRIVATE' && collection.ownerId !== user?.userId) {
      return NextResponse.json(
        { success: false, error: { message: '접근 권한이 없습니다.', code: 'FORBIDDEN' } },
        { status: 403 }
      );
    }

    return NextResponse.json({ success: true, data: collection });
  } catch (error) {
    console.error('Get collection error:', error);
    return NextResponse.json(
      { success: false, error: { message: '오류가 발생했습니다.', code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(await authenticateRequest(request), 'ADMIN', 'MEMBER');
    const { id } = await params;
    const { name, description, visibility } = await request.json();

    const collection = await prisma.collection.findUnique({ where: { id } });
    if (!collection) {
      return NextResponse.json(
        { success: false, error: { message: '컬렉션을 찾을 수 없습니다.', code: 'NOT_FOUND' } },
        { status: 404 }
      );
    }

    if (collection.ownerId !== user.userId && user.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, error: { message: '수정 권한이 없습니다.', code: 'FORBIDDEN' } },
        { status: 403 }
      );
    }

    const updated = await prisma.collection.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(visibility !== undefined && { visibility }),
      },
      include: { owner: { select: { name: true } } },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: { message: error.message, code: 'AUTH_ERROR' } },
        { status: error.statusCode }
      );
    }
    console.error('Update collection error:', error);
    return NextResponse.json(
      { success: false, error: { message: '오류가 발생했습니다.', code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(await authenticateRequest(request), 'ADMIN', 'MEMBER');
    const { id } = await params;

    const collection = await prisma.collection.findUnique({ where: { id } });
    if (!collection) {
      return NextResponse.json(
        { success: false, error: { message: '컬렉션을 찾을 수 없습니다.', code: 'NOT_FOUND' } },
        { status: 404 }
      );
    }

    if (collection.ownerId !== user.userId && user.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, error: { message: '삭제 권한이 없습니다.', code: 'FORBIDDEN' } },
        { status: 403 }
      );
    }

    await prisma.collection.delete({ where: { id } });

    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: { message: error.message, code: 'AUTH_ERROR' } },
        { status: error.statusCode }
      );
    }
    console.error('Delete collection error:', error);
    return NextResponse.json(
      { success: false, error: { message: '오류가 발생했습니다.', code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}
