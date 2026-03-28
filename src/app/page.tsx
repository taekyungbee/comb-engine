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

  if (loading) return <div className="text-text-muted">로딩 중...</div>;
  if (!stats) return <div className="text-error">통계를 불러올 수 없습니다</div>;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">대시보드</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatCard title="소스" value={stats.sources} />
        <StatCard title="문서" value={stats.documents} />
        <StatCard title="청크" value={stats.chunks} />
      </div>

      {stats.sourceBreakdown.length > 0 && (
        <div className="card p-4 mb-8">
          <h3 className="font-semibold mb-3">소스 유형별 분포</h3>
          <div className="flex flex-wrap gap-2">
            {stats.sourceBreakdown.map((s) => (
              <span
                key={s.sourceType}
                className="px-3 py-1 text-sm bg-white/5 rounded-full"
              >
                {s.sourceType}: {s.count}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card p-4">
        <h3 className="font-semibold mb-3">최근 수집 이력</h3>
        {stats.recentRuns.length === 0 ? (
          <p className="text-text-muted text-sm">수집 이력이 없습니다</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted border-b border-border">
                <th className="pb-2">소스</th>
                <th className="pb-2">유형</th>
                <th className="pb-2">상태</th>
                <th className="pb-2">신규</th>
                <th className="pb-2">갱신</th>
                <th className="pb-2">시간</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentRuns.map((run) => (
                <tr key={run.id} className="border-b border-border">
                  <td className="py-2">{run.source.name}</td>
                  <td className="py-2">{run.source.type}</td>
                  <td className="py-2">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="py-2">{run.itemsNew}</td>
                  <td className="py-2">{run.itemsUpdated}</td>
                  <td className="py-2 text-text-muted">
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
      <p className="text-sm text-text-muted">{title}</p>
      <p className="text-3xl font-bold mt-1">{value.toLocaleString()}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    SUCCESS: 'badge-success',
    PARTIAL: 'badge-warning',
    FAILED: 'badge-error',
    RUNNING: 'badge-info',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] || 'bg-white/5'}`}>
      {status}
    </span>
  );
}
