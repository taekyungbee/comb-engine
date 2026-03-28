'use client';

import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: '대시보드' },
  { href: '/sources', label: '소스 관리' },
  { href: '/search', label: '검색' },
  { href: '/collections', label: '수집 이력' },
  { href: '/my-collections', label: '컬렉션' },
  { href: '/api-keys', label: 'API 키' },
];

export function NavContent() {
  const { data: session } = useSession();
  const pathname = usePathname();

  if (pathname === '/login') return null;

  return (
    <nav className="w-56 border-r border-border bg-bg-secondary flex flex-col">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent-primary flex items-center justify-center">
            <svg className="w-4 h-4 text-bg-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75" />
            </svg>
          </div>
          <span className="text-sm font-bold text-text-primary tracking-tight">Comb Engine</span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 p-2 flex-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <a
              key={item.href}
              href={item.href}
              className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-accent-primary/10 text-accent-primary font-medium'
                  : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
              }`}
            >
              {item.label}
            </a>
          );
        })}
      </div>
      {session?.user && (
        <div className="border-t border-border p-3">
          <p className="px-1 text-xs text-text-muted truncate mb-2">
            {session.user.email}
          </p>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="w-full px-3 py-1.5 text-xs text-left text-text-muted hover:text-error rounded-lg hover:bg-white/5 transition-colors"
          >
            로그아웃
          </button>
        </div>
      )}
    </nav>
  );
}
