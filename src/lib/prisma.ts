import { PrismaClient } from '@prisma/client';

// PrismaClient 싱글톤 인스턴스
// 개발 환경에서 핫 리로딩 시 여러 인스턴스 생성 방지

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
