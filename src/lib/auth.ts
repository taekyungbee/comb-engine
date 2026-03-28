import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';
import type { Adapter } from 'next-auth/adapters';

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  adapter: PrismaAdapter(prisma) as Adapter,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'database',
  },
  events: {
    async createUser({ user }) {
      // 첫 번째 가입자 = 자동 ADMIN
      const userCount = await prisma.user.count();
      if (userCount === 1) {
        await prisma.user.update({
          where: { id: user.id },
          data: { role: 'ADMIN' },
        });
      }
    },
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.id) return true;

      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
      });

      // 기존 사용자 → 허용
      if (dbUser) return true;

      // 신규 사용자 → 이미 1명 이상이면 차단
      const userCount = await prisma.user.count();
      if (userCount >= 1) {
        return '/login?error=closed';
      }

      return true;
    },
    async session({ session, user }) {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, role: true },
      });
      if (dbUser) {
        session.user.id = dbUser.id;
        session.user.role = dbUser.role;
      }
      return session;
    },
  },
});
