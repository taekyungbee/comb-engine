import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { NavContent } from './nav-content';

export const metadata: Metadata = {
  title: 'Comb Engine',
  description: '데이터 수집 + RAG 파이프라인',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="min-h-screen antialiased">
        <Providers>
          <div className="flex min-h-screen">
            <NavContent />
            <main className="flex-1 p-6 bg-bg-primary">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
