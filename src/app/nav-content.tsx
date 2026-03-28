'use client';

import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';

export function NavContent() {
  const { data: session } = useSession();
  const pathname = usePathname();

  // 로그인 페이지에서는 네비 숨김
  if (pathname === '/login') return null;

  return (
    <nav className="w-56 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 flex flex-col">
      <h1 className="text-lg font-bold mb-4 px-3">Comb Engine</h1>
      <div className="flex flex-col gap-1 flex-1">
        <NavLink href="/" label="Dashboard" />
        <NavLink href="/sources" label="Sources" />
        <NavLink href="/search" label="Search" />
        <NavLink href="/collections" label="History" />
        <NavLink href="/my-collections" label="Collections" />
        <NavLink href="/api-keys" label="API Keys" />
      </div>
      {session?.user && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
          <p className="px-3 text-xs text-gray-500 dark:text-gray-400 truncate mb-2">
            {session.user.email}
          </p>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="w-full px-3 py-2 text-sm text-left text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
          >
            로그아웃
          </button>
        </div>
      )}
    </nav>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="px-3 py-2 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
    >
      {label}
    </a>
  );
}
