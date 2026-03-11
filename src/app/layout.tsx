import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RAG Collector',
  description: '자동화된 데이터 수집 + RAG 파이프라인',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen">
          <nav className="w-56 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 flex flex-col gap-1">
            <h1 className="text-lg font-bold mb-4 px-3">RAG Collector</h1>
            <NavLink href="/" label="Dashboard" />
            <NavLink href="/sources" label="Sources" />
            <NavLink href="/search" label="Search" />
            <NavLink href="/collections" label="History" />
            <NavLink href="/my-collections" label="Collections" />
            <NavLink href="/api-keys" label="API Keys" />
            <NavLink href="/settings" label="Settings" />
          </nav>
          <main className="flex-1 p-6 bg-gray-50 dark:bg-gray-950">
            {children}
          </main>
        </div>
      </body>
    </html>
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
