'use client';

import { useEffect, useState } from 'react';

interface CollectionRun {
  id: string;
  status: string;
  itemsFound: number;
  itemsNew: number;
  itemsUpdated: number;
  itemsSkipped: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  source: { name: string; type: string };
}

export default function CollectionsPage() {
  const [runs, setRuns] = useState<CollectionRun[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetch(`/api/collections?page=${page}&pageSize=20`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setRuns(data.data.runs);
          setTotalPages(data.data.pagination.totalPages);
        }
      });
  }, [page]);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">수집 이력</h2>

      {runs.length === 0 ? (
        <p className="text-text-muted text-center py-8">수집 이력이 없습니다</p>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted bg-bg-secondary">
                <th className="px-4 py-3">소스</th>
                <th className="px-4 py-3">타입</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">발견</th>
                <th className="px-4 py-3">신규</th>
                <th className="px-4 py-3">갱신</th>
                <th className="px-4 py-3">건너뜀</th>
                <th className="px-4 py-3">시작 시간</th>
                <th className="px-4 py-3">소요 시간</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const duration = run.completedAt
                  ? Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
                  : null;
                return (
                  <tr key={run.id} className="border-t border-border">
                    <td className="px-4 py-3">{run.source.name}</td>
                    <td className="px-4 py-3">{run.source.type}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="px-4 py-3">{run.itemsFound}</td>
                    <td className="px-4 py-3">{run.itemsNew}</td>
                    <td className="px-4 py-3">{run.itemsUpdated}</td>
                    <td className="px-4 py-3">{run.itemsSkipped}</td>
                    <td className="px-4 py-3 text-text-muted">
                      {new Date(run.startedAt).toLocaleString('ko-KR')}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {duration !== null ? `${duration}초` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn-outline text-sm"
          >
            이전
          </button>
          <span className="px-3 py-2 text-sm text-text-muted">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="btn-outline text-sm"
          >
            다음
          </button>
        </div>
      )}
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
