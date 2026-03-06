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
      <h2 className="text-2xl font-bold mb-6">Collection History</h2>

      {runs.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No collection runs yet</p>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 bg-gray-50 dark:bg-gray-800">
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Found</th>
                <th className="px-4 py-3">New</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Skipped</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Duration</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const duration = run.completedAt
                  ? Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
                  : null;
                return (
                  <tr key={run.id} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="px-4 py-3">{run.source.name}</td>
                    <td className="px-4 py-3">{run.source.type}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="px-4 py-3">{run.itemsFound}</td>
                    <td className="px-4 py-3">{run.itemsNew}</td>
                    <td className="px-4 py-3">{run.itemsUpdated}</td>
                    <td className="px-4 py-3">{run.itemsSkipped}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(run.startedAt).toLocaleString('ko-KR')}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {duration !== null ? `${duration}s` : '-'}
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
            Prev
          </button>
          <span className="px-3 py-2 text-sm text-gray-500">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="btn-outline text-sm"
          >
            Next
          </button>
        </div>
      )}
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
