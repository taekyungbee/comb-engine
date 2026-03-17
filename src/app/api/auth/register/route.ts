import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword, signToken, generateApiKey, hashApiKey } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json();

    if (!email || !password || !name) {
      return NextResponse.json(
        { success: false, error: { message: '이메일, 비밀번호, 이름이 필요합니다.', code: 'MISSING_FIELDS' } },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { success: false, error: { message: '이미 등록된 이메일입니다.', code: 'DUPLICATE_EMAIL' } },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);

    // 첫 번째 사용자는 ADMIN
    const userCount = await prisma.user.count();
    const role = userCount === 0 ? 'ADMIN' : 'MEMBER';

    const user = await prisma.user.create({
      data: { email, passwordHash, name, role },
      select: { id: true, email: true, name: true, role: true },
    });

    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    // API Key 자동 발급
    const { key: apiKey, prefix } = generateApiKey();
    await prisma.apiKey.create({
      data: {
        userId: user.id,
        name: 'default',
        keyHash: hashApiKey(apiKey),
        keyPrefix: prefix,
      },
    });

    return NextResponse.json({ success: true, data: { user, token, apiKey } }, { status: 201 });
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json(
      { success: false, error: { message: '회원가입 처리 중 오류가 발생했습니다.', code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}
