import { createHash, randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import type { NextRequest } from 'next/server';
import type { UserRole } from '@prisma/client';

// =============================================
// API Key
// =============================================

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): { key: string; prefix: string } {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'rag_';
  const bytes = randomBytes(48);
  for (let i = 0; i < 48; i++) {
    key += chars.charAt(bytes[i] % chars.length);
  }
  return { key, prefix: key.slice(0, 8) };
}

// =============================================
// Request 인증 (API Key + NextAuth 세션)
// =============================================

export interface AuthUser {
  userId: string;
  email: string;
  role: UserRole;
}

export async function authenticateRequest(request: NextRequest): Promise<AuthUser | null> {
  const authHeader = request.headers.get('Authorization');

  // API Key 인증 (외부 클라이언트)
  if (authHeader?.startsWith('ApiKey ')) {
    const apiKey = authHeader.slice(7);
    const keyHash = hashApiKey(apiKey);

    const found = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: { user: true },
    });

    if (!found) return null;
    if (found.expiresAt && found.expiresAt < new Date()) return null;

    await prisma.apiKey.update({
      where: { id: found.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      userId: found.user.id,
      email: found.user.email,
      role: found.user.role,
    };
  }

  // NextAuth 세션 인증 (Web UI)
  const session = await auth();
  if (session?.user) {
    return {
      userId: session.user.id,
      email: session.user.email,
      role: session.user.role,
    };
  }

  return null;
}

export function requireRole(user: AuthUser | null, ...roles: UserRole[]): AuthUser {
  if (!user) throw new AuthError('인증이 필요합니다.', 401);
  if (!roles.includes(user.role)) throw new AuthError('권한이 없습니다.', 403);
  return user;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
