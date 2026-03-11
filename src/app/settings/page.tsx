'use client';

import { useState, useEffect } from 'react';

interface UserInfo {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

export default function SettingsPage() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const token = typeof window !== 'undefined' ? localStorage.getItem('rag_token') : null;

  useEffect(() => {
    if (!token) return;
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setUser(data.data);
        else {
          localStorage.removeItem('rag_token');
          setUser(null);
        }
      });
  }, [token]);

  const handleAuth = async () => {
    setError('');
    setMessage('');

    const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body = mode === 'login' ? { email, password } : { email, password, name };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (data.success) {
      localStorage.setItem('rag_token', data.data.token);
      setUser(data.data.user);
      setEmail('');
      setPassword('');
      setName('');
      setMessage(mode === 'login' ? '로그인 성공!' : '가입 완료!');
    } else {
      setError(data.error?.message || '오류가 발생했습니다.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('rag_token');
    setUser(null);
    setMessage('로그아웃 되었습니다.');
  };

  return (
    <div className="max-w-md mx-auto">
      <h2 className="text-2xl font-bold mb-6">Settings</h2>

      {user ? (
        <div className="card p-6">
          <h3 className="font-semibold mb-4">사용자 정보</h3>
          <div className="space-y-2 text-sm mb-4">
            <p><span className="text-gray-500">이름:</span> {user.name}</p>
            <p><span className="text-gray-500">이메일:</span> {user.email}</p>
            <p>
              <span className="text-gray-500">역할:</span>{' '}
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                {user.role}
              </span>
            </p>
            <p>
              <span className="text-gray-500">가입일:</span>{' '}
              {new Date(user.createdAt).toLocaleDateString('ko-KR')}
            </p>
          </div>
          <button onClick={handleLogout} className="btn-outline text-sm px-4 py-2">
            로그아웃
          </button>
        </div>
      ) : (
        <div className="card p-6">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setMode('login')}
              className={`px-3 py-1 text-sm rounded ${mode === 'login' ? 'bg-blue-100 text-blue-700' : 'text-gray-500'}`}
            >
              로그인
            </button>
            <button
              onClick={() => setMode('register')}
              className={`px-3 py-1 text-sm rounded ${mode === 'register' ? 'bg-blue-100 text-blue-700' : 'text-gray-500'}`}
            >
              회원가입
            </button>
          </div>

          <div className="space-y-3">
            {mode === 'register' && (
              <div>
                <label className="text-sm text-gray-500 block mb-1">이름</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
                />
              </div>
            )}
            <div>
              <label className="text-sm text-gray-500 block mb-1">이메일</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
              />
            </div>
            <div>
              <label className="text-sm text-gray-500 block mb-1">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
                onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
              />
            </div>
            <button onClick={handleAuth} className="btn-primary w-full py-2">
              {mode === 'login' ? '로그인' : '가입하기'}
            </button>
          </div>

          {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
        </div>
      )}

      {message && (
        <p className="text-green-600 text-sm mt-3 text-center">{message}</p>
      )}
    </div>
  );
}
