'use client';

import { useEffect, useState } from 'react';

interface Stats {
  sources: number;
  documents: number;
  chunks: number;
  sourceBreakdown: { sourceType: string; count: number }[];
  recentRuns: {
    id: string;
    status: string;
    itemsNew: number;
    itemsUpdated: number;
    startedAt: string;
    source: { name: string; type: string };
  }[];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setStats(data.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-500">Loading...</div>;
  if (!stats) return <div className="text-red-500">Failed to load stats</div>;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Dashboard</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatCard title="Sources" value={stats.sources} />
        <StatCard title="Documents" value={stats.documents} />
        <StatCard title="Chunks" value={stats.chunks} />
      </div>

      {stats.sourceBreakdown.length > 0 && (
        <div className="card p-4 mb-8">
          <h3 className="font-semibold mb-3">Source Breakdown</h3>
          <div className="flex flex-wrap gap-2">
            {stats.sourceBreakdown.map((s) => (
              <span
                key={s.sourceType}
                className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded-full"
              >
                {s.sourceType}: {s.count}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card p-4">
        <h3 className="font-semibold mb-3">Recent Collections</h3>
        {stats.recentRuns.length === 0 ? (
          <p className="text-gray-500 text-sm">No collections yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Source</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">New</th>
                <th className="pb-2">Updated</th>
                <th className="pb-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentRuns.map((run) => (
                <tr key={run.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2">{run.source.name}</td>
                  <td className="py-2">{run.source.type}</td>
                  <td className="py-2">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="py-2">{run.itemsNew}</td>
                  <td className="py-2">{run.itemsUpdated}</td>
                  <td className="py-2 text-gray-500">
                    {new Date(run.startedAt).toLocaleString('ko-KR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: number }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-3xl font-bold mt-1">{value.toLocaleString()}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    SUCCESS: 'bg-green-100 text-green-700',
    PARTIAL: 'bg-yellow-100 text-yellow-700',
    FAILED: 'bg-red-100 text-red-700',
    RUNNING: 'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] || 'bg-gray-100'}`}>
      {status}
    </span>
  );
}
