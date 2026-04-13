'use client';

import { useEffect, useState, useCallback } from 'react';

interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  keyDisplay?: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export function ApiKeysDashboard() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState<number | ''>('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchKeys = useCallback(async () => {
    const res = await fetch('/api/api-keys');
    const data = await res.json();
    if (data.success) setKeys(data.data);
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setError('');
    setCreatedKey(null);

    const res = await fetch('/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    if (!confirm('이 API 키를 삭제하시겠습니까?')) return;

    await fetch(`/api/api-keys/${id}`, { method: 'DELETE' });
    fetchKeys();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('클립보드에 복사되었습니다.');
  };

  return (
    <div>
      <div className="card p-4 mb-6">
        <h3 className="font-semibold mb-3">새 API 키 생성</h3>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-sm text-text-muted block mb-1">이름</label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="예: Claude Code, MCP Client"
              className="input-field w-full"
            />
          </div>
          <div className="w-40">
            <label className="text-sm text-text-muted block mb-1">만료 (일)</label>
            <input
              type="number"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value ? parseInt(e.target.value) : '')}
              placeholder="미설정: 무기한"
              className="input-field w-full"
            />
          </div>
          <button onClick={handleCreate} className="btn-primary px-4 py-2">
            생성
          </button>
        </div>
        {error && <p className="text-error text-sm mt-2">{error}</p>}
      </div>

      {createdKey && (
        <div className="bg-success/10 border border-success/30 rounded-md p-4 mb-6">
          <p className="text-sm font-semibold text-success mb-2">
            API 키가 생성되었습니다. 이 키는 다시 확인할 수 없으니 안전하게 보관하세요.
          </p>
          <div className="flex items-center gap-2">
            <code className="block bg-bg-secondary p-2 rounded text-sm break-all flex-1">
              {createdKey}
            </code>
            <button 
              onClick={() => copyToClipboard(createdKey)}
              className="btn-secondary px-3 py-1 text-sm"
            >
              복사
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted bg-bg-secondary">
              <th className="px-4 py-3">이름</th>
              <th className="px-4 py-3">키</th>
              <th className="px-4 py-3">마지막 사용</th>
              <th className="px-4 py-3">만료</th>
              <th className="px-4 py-3">생성일</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                  생성된 API 키가 없습니다.
                </td>
              </tr>
            ) : (
              keys.map((k) => (
                <tr key={k.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{k.name}</td>
                  <td className="px-4 py-3">
                    <code className="bg-white/5 px-2 py-0.5 rounded text-xs">
                      {k.keyDisplay || `${k.keyPrefix}...`}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('ko-KR') : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString('ko-KR') : '무기한'}
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {new Date(k.createdAt).toLocaleDateString('ko-KR')}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(k.id)}
                      className="text-error hover:text-error/80 text-xs"
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
