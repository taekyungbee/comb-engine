'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';

interface Collection {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  owner: { name: string };
  _count: { documents: number };
  createdAt: string;
}

export default function MyCollectionsPage() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formVisibility, setFormVisibility] = useState('PRIVATE');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { data: session } = useSession();

  const fetchCollections = useCallback(async () => {
    const res = await fetch('/api/collections/manage');
    const data = await res.json();
    if (data.success) setCollections(data.data);
  }, []);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  const handleSubmit = async () => {
    if (!formName.trim()) return;
    setError('');

    const method = editingId ? 'PUT' : 'POST';
    const url = editingId ? `/api/collections/manage/${editingId}` : '/api/collections/manage';

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: formName,
        description: formDesc || null,
        visibility: formVisibility,
      }),
    });

    const data = await res.json();
    if (data.success) {
      resetForm();
      fetchCollections();
    } else {
      setError(data.error?.message || '오류 발생');
    }
  };

  const handleEdit = (c: Collection) => {
    setEditingId(c.id);
    setFormName(c.name);
    setFormDesc(c.description || '');
    setFormVisibility(c.visibility);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 컬렉션을 삭제하시겠습니까?')) return;

    await fetch(`/api/collections/manage/${id}`, {
      method: 'DELETE',
    });
    fetchCollections();
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormName('');
    setFormDesc('');
    setFormVisibility('PRIVATE');
    setError('');
  };

  const visibilityBadge = (v: string) => {
    const colors: Record<string, string> = {
      PRIVATE: 'bg-white/10 text-text-secondary',
      SHARED: 'badge-info',
      PUBLIC: 'badge-success',
    };
    const labels: Record<string, string> = {
      PRIVATE: '비공개',
      SHARED: '팀 공유',
      PUBLIC: '전체 공개',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[v] || 'bg-white/5'}`}>
        {labels[v] || v}
      </span>
    );
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">컬렉션 관리</h2>
        {session && (
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="btn-primary text-sm px-4 py-2"
          >
            새 컬렉션
          </button>
        )}
      </div>

      {/* 생성/수정 폼 */}
      {showForm && (
        <div className="card p-4 mb-6">
          <h3 className="font-semibold mb-3">
            {editingId ? '컬렉션 수정' : '새 컬렉션 생성'}
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-text-muted block mb-1">이름</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="text-sm text-text-muted block mb-1">설명</label>
              <textarea
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                rows={2}
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="text-sm text-text-muted block mb-1">가시성</label>
              <select
                value={formVisibility}
                onChange={(e) => setFormVisibility(e.target.value)}
                className="input-field"
              >
                <option value="PRIVATE">비공개 - 본인만</option>
                <option value="SHARED">팀 공유 - 팀원 공유</option>
                <option value="PUBLIC">전체 공개</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSubmit} className="btn-primary text-sm px-4 py-2">
                {editingId ? '수정' : '생성'}
              </button>
              <button onClick={resetForm} className="btn-outline text-sm px-4 py-2">
                취소
              </button>
            </div>
            {error && <p className="text-error text-sm">{error}</p>}
          </div>
        </div>
      )}

      {/* 목록 */}
      {collections.length === 0 ? (
        <p className="text-text-muted text-center py-8">컬렉션이 없습니다.</p>
      ) : (
        <div className="grid gap-4">
          {collections.map((c) => (
            <div key={c.id} className="card p-4 flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold">{c.name}</h3>
                  {visibilityBadge(c.visibility)}
                </div>
                {c.description && (
                  <p className="text-sm text-text-muted mb-2">{c.description}</p>
                )}
                <div className="text-xs text-text-muted flex gap-3">
                  <span>{c._count.documents}개 문서</span>
                  <span>{c.owner.name}</span>
                  <span>{new Date(c.createdAt).toLocaleDateString('ko-KR')}</span>
                </div>
              </div>
              {session && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(c)}
                    className="text-accent-primary hover:text-accent-primary/80 text-xs"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="text-error hover:text-error/80 text-xs"
                  >
                    삭제
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
