'use client';

import { useEffect, useState, useCallback } from 'react';

interface Source {
  id: string;
  name: string;
  type: string;
  url: string | null;
  cronExpr: string | null;
  enabled: boolean;
  tags: string[];
  lastRunAt: string | null;
  lastStatus: string | null;
  _count: { documents: number; runs: number };
}

const SOURCE_TYPES = [
  'WEB_CRAWL',
  'YOUTUBE_CHANNEL',
  'RSS_FEED',
  'GITHUB_REPO',
  'GIT_CLONE',
  'DOCUMENT_FILE',
  'GOOGLE_WORKSPACE',
  'GMAIL',
  'GOOGLE_CALENDAR',
  'GOOGLE_CHAT',
  'NOTION_PAGE',
  'MOLTBOOK',
] as const;

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [collecting, setCollecting] = useState<string | null>(null);

  const loadSources = useCallback(() => {
    fetch('/api/sources')
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setSources(data.data);
      });
  }, []);

  useEffect(() => { loadSources(); }, [loadSources]);

  const handleCollect = async (sourceId: string) => {
    setCollecting(sourceId);
    try {
      await fetch('/api/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId }),
      });
      loadSources();
    } finally {
      setCollecting(null);
    }
  };

  const handleDelete = async (sourceId: string) => {
    if (!confirm('이 소스와 관련 문서를 모두 삭제하시겠습니까?')) return;
    await fetch(`/api/sources/${sourceId}`, { method: 'DELETE' });
    loadSources();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">소스 관리</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary"
        >
          {showForm ? '취소' : '소스 추가'}
        </button>
      </div>

      {showForm && (
        <AddSourceForm
          onCreated={() => {
            setShowForm(false);
            loadSources();
          }}
        />
      )}

      <div className="grid gap-4">
        {sources.map((source) => (
          <div key={source.id} className="card p-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{source.name}</h3>
                  <span className="px-2 py-0.5 rounded text-xs bg-white/5">
                    {source.type}
                  </span>
                  {!source.enabled && (
                    <span className="badge-error px-2 py-0.5 rounded text-xs">
                      비활성
                    </span>
                  )}
                </div>
                {source.url && (
                  <p className="text-sm text-text-muted mt-1 truncate max-w-xl">{source.url}</p>
                )}
                <div className="flex gap-4 mt-2 text-xs text-text-muted">
                  <span>스케줄: {source.cronExpr || '수동'}</span>
                  <span>문서: {source._count.documents}</span>
                  <span>실행: {source._count.runs}</span>
                  {source.lastRunAt && (
                    <span>최근: {new Date(source.lastRunAt).toLocaleString('ko-KR')}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleCollect(source.id)}
                  disabled={collecting === source.id}
                  className="btn-secondary text-xs"
                >
                  {collecting === source.id ? '수집 중...' : '지금 수집'}
                </button>
                <button
                  onClick={() => handleDelete(source.id)}
                  className="btn-outline text-xs text-error"
                >
                  삭제
                </button>
              </div>
            </div>
          </div>
        ))}
        {sources.length === 0 && (
          <p className="text-text-muted text-center py-8">등록된 소스가 없습니다</p>
        )}
      </div>
    </div>
  );
}

function AddSourceForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('RSS_FEED');
  const [url, setUrl] = useState('');
  const [cronExpr, setCronExpr] = useState('');
  const [configJson, setConfigJson] = useState('{}');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let config = {};
      try { config = JSON.parse(configJson); } catch { /* ignore */ }

      const response = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          type,
          url: url || undefined,
          cronExpr: cronExpr || undefined,
          config,
        }),
      });
      const data = await response.json();
      if (data.success) onCreated();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card p-4 mb-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">이름</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-field w-full"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">유형</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="input-field w-full"
          >
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">URL</label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="input-field w-full"
          placeholder="https://..."
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Cron 표현식</label>
          <input
            type="text"
            value={cronExpr}
            onChange={(e) => setCronExpr(e.target.value)}
            className="input-field w-full"
            placeholder="0 */6 * * * (6시간마다)"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">설정 (JSON)</label>
          <input
            type="text"
            value={configJson}
            onChange={(e) => setConfigJson(e.target.value)}
            className="input-field w-full"
            placeholder='{"maxItems": 50}'
          />
        </div>
      </div>
      <button type="submit" disabled={submitting || !name} className="btn-primary">
        {submitting ? '생성 중...' : '소스 생성'}
      </button>
    </form>
  );
}
