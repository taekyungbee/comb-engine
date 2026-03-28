'use client';

import { useSession, signOut } from 'next-auth/react';

export default function SettingsPage() {
  const { data: session } = useSession();

  if (!session?.user) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">로그인이 필요합니다.</p>
      </div>
    );
  }

  const user = session.user;

  return (
    <div className="max-w-md mx-auto">
      <h2 className="text-2xl font-bold mb-6">Settings</h2>

      <div className="card p-6">
        <h3 className="font-semibold mb-4">사용자 정보</h3>
        <div className="space-y-2 text-sm mb-4">
          <p>
            <span className="text-gray-500">이름:</span> {user.name || '-'}
          </p>
          <p>
            <span className="text-gray-500">이메일:</span> {user.email}
          </p>
          <p>
            <span className="text-gray-500">역할:</span>{' '}
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
              {user.role}
            </span>
          </p>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="btn-outline text-sm px-4 py-2"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
