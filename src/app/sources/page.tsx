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
  'DOCUMENT_FILE',
  'NOTION_PAGE',
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
    if (!confirm('Delete this source and all its documents?')) return;
    await fetch(`/api/sources/${sourceId}`, { method: 'DELETE' });
    loadSources();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Sources</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary"
        >
          {showForm ? 'Cancel' : 'Add Source'}
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
                  <span className="px-2 py-0.5 rounded text-xs bg-gray-200 dark:bg-gray-700">
                    {source.type}
                  </span>
                  {!source.enabled && (
                    <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-600">
                      Disabled
                    </span>
                  )}
                </div>
                {source.url && (
                  <p className="text-sm text-gray-500 mt-1 truncate max-w-xl">{source.url}</p>
                )}
                <div className="flex gap-4 mt-2 text-xs text-gray-500">
                  <span>Cron: {source.cronExpr || 'Manual'}</span>
                  <span>Docs: {source._count.documents}</span>
                  <span>Runs: {source._count.runs}</span>
                  {source.lastRunAt && (
                    <span>Last: {new Date(source.lastRunAt).toLocaleString('ko-KR')}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleCollect(source.id)}
                  disabled={collecting === source.id}
                  className="btn-secondary text-xs"
                >
                  {collecting === source.id ? 'Collecting...' : 'Collect Now'}
                </button>
                <button
                  onClick={() => handleDelete(source.id)}
                  className="btn-outline text-xs text-red-500"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
        {sources.length === 0 && (
          <p className="text-gray-500 text-center py-8">No sources configured yet</p>
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
          <label className="block text-sm font-medium mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-600"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full px-3 py-2 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-600"
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
          className="w-full px-3 py-2 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-600"
          placeholder="https://..."
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Cron Expression</label>
          <input
            type="text"
            value={cronExpr}
            onChange={(e) => setCronExpr(e.target.value)}
            className="w-full px-3 py-2 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-600"
            placeholder="0 */6 * * * (every 6 hours)"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Config (JSON)</label>
          <input
            type="text"
            value={configJson}
            onChange={(e) => setConfigJson(e.target.value)}
            className="w-full px-3 py-2 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-600"
            placeholder='{"maxItems": 50}'
          />
        </div>
      </div>
      <button type="submit" disabled={submitting || !name} className="btn-primary">
        {submitting ? 'Creating...' : 'Create Source'}
      </button>
    </form>
  );
}
