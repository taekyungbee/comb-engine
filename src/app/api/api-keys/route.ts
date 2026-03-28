import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, generateApiKey, hashApiKey, AuthError, requireRole } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    const user = requireRole(await authenticateRequest(request), 'ADMIN', 'MEMBER');

    const keys = await prisma.apiKey.findMany({
      where: { userId: user.userId },
      select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, data: keys });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: { message: error.message, code: 'AUTH_ERROR' } },
        { status: error.statusCode }
      );
    }
    console.error('List API keys error:', error);
    return NextResponse.json(
      { success: false, error: { message: '오류가 발생했습니다.', code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = requireRole(await authenticateRequest(request), 'ADMIN', 'MEMBER');
    const { name, expiresInDays } = await request.json();

    if (!name) {
      return NextResponse.json(
        { success: false, error: { message: 'API Key 이름이 필요합니다.', code: 'MISSING_FIELDS' } },
        { status: 400 }
      );
    }

    const { key, prefix } = generateApiKey();
    const keyHash = hashApiKey(key);

    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const apiKey = await prisma.apiKey.create({
      data: {
        userId: user.userId,
        name,
        keyHash,
        keyPrefix: prefix,
        expiresAt,
      },
      select: { id: true, name: true, keyPrefix: true, expiresAt: true, createdAt: true },
    });

    // key는 생성 시에만 반환 (이후에는 조회 불가)
    return NextResponse.json(
      { success: true, data: { ...apiKey, key } },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: { message: error.message, code: 'AUTH_ERROR' } },
        { status: error.statusCode }
      );
    }
    console.error('Create API key error:', error);
    return NextResponse.json(
      { success: false, error: { message: '오류가 발생했습니다.', code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}
