import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { NextRequest } from 'next/server';
import type { UserRole } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'rag-collector-secret-key';
const SALT_ROUNDS = 10;

// =============================================
// JWT
// =============================================

export interface TokenPayload {
  userId: string;
  email: string;
  role: UserRole;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

// =============================================
// Password
// =============================================

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// =============================================
// API Key
// =============================================

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): { key: string; prefix: string } {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'rag_';
  for (let i = 0; i < 48; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return { key, prefix: key.slice(0, 8) };
}

// =============================================
// Request 인증
// =============================================

export interface AuthUser {
  userId: string;
  email: string;
  role: UserRole;
}

export async function authenticateRequest(request: NextRequest): Promise<AuthUser | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return null;

  // Bearer JWT 토큰
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    if (payload) return payload;
  }

  // API Key
  if (authHeader.startsWith('ApiKey ')) {
    const apiKey = authHeader.slice(7);
    const keyHash = hashApiKey(apiKey);

    const found = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: { user: true },
    });

    if (!found) return null;

    // 만료 확인
    if (found.expiresAt && found.expiresAt < new Date()) return null;

    // lastUsedAt 업데이트
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
    public statusCode: number
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
