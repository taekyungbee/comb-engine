'use client';

import { useEffect, useState, useCallback } from 'react';

interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState<number | ''>('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  const token = typeof window !== 'undefined' ? localStorage.getItem('rag_token') : null;

  const fetchKeys = useCallback(async () => {
    if (!token) return;
    const res = await fetch('/api/api-keys', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.success) setKeys(data.data);
  }, [token]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setError('');
    setCreatedKey(null);

    const res = await fetch('/api/api-keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: newKeyName,
        ...(expiresInDays ? { expiresInDays: Number(expiresInDays) } : {}),
      }),
    });

    const data = await res.json();
    if (data.success) {
      setCreatedKey(data.data.key);
      setNewKeyName('');
      setExpiresInDays('');
      fetchKeys();
    } else {
      setError(data.error?.message || '생성 실패');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 API Key를 삭제하시겠습니까?')) return;

    await fetch(`/api/api-keys/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchKeys();
  };

  if (!token) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-4">로그인이 필요합니다.</p>
        <a href="/settings" className="text-blue-600 hover:underline">Settings에서 로그인</a>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">API Keys</h2>

      {/* 생성 폼 */}
      <div className="card p-4 mb-6">
        <h3 className="font-semibold mb-3">새 API Key 생성</h3>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-sm text-gray-500 block mb-1">이름</label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="예: Claude Code, MCP Client"
              className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
            />
          </div>
          <div className="w-40">
            <label className="text-sm text-gray-500 block mb-1">만료 (일)</label>
            <input
              type="number"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value ? parseInt(e.target.value) : '')}
              placeholder="미설정: 무기한"
              className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
            />
          </div>
          <button onClick={handleCreate} className="btn-primary px-4 py-2">
            생성
          </button>
        </div>
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      </div>

      {/* 생성된 키 표시 */}
      {createdKey && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md p-4 mb-6">
          <p className="text-sm font-semibold text-green-700 dark:text-green-400 mb-2">
            API Key가 생성되었습니다. 이 키는 다시 확인할 수 없으니 안전하게 보관하세요.
          </p>
          <code className="block bg-white dark:bg-gray-900 p-2 rounded text-sm break-all">
            {createdKey}
          </code>
        </div>
      )}

      {/* 키 목록 */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 bg-gray-50 dark:bg-gray-800">
              <th className="px-4 py-3">이름</th>
              <th className="px-4 py-3">키 접두사</th>
              <th className="px-4 py-3">마지막 사용</th>
              <th className="px-4 py-3">만료</th>
              <th className="px-4 py-3">생성일</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  생성된 API Key가 없습니다.
                </td>
              </tr>
            ) : (
              keys.map((k) => (
                <tr key={k.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-4 py-3 font-medium">{k.name}</td>
                  <td className="px-4 py-3">
                    <code className="bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded text-xs">
                      {k.keyPrefix}...
                    </code>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('ko-KR') : '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString('ko-KR') : '무기한'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(k.createdAt).toLocaleDateString('ko-KR')}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(k.id)}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
