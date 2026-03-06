'use client';

import { useState } from 'react';

interface SearchResult {
  chunkId: string;
  documentId: string;
  content: string;
  similarity: number;
  sourceType: string;
  title: string;
  url: string | null;
  publishedAt: string | null;
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setSearching(true);
    setSearched(true);
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 20, threshold: 0.5 }),
      });
      const data = await response.json();
      if (data.success) setResults(data.data.results);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Vector Search</h2>

      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search collected documents..."
          className="flex-1 px-4 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-600"
        />
        <button type="submit" disabled={searching} className="btn-primary">
          {searching ? 'Searching...' : 'Search'}
        </button>
      </form>

      {searched && results.length === 0 && !searching && (
        <p className="text-gray-500 text-center py-8">No results found</p>
      )}

      <div className="space-y-4">
        {results.map((result) => (
          <div key={result.chunkId} className="card p-4">
            <div className="flex justify-between items-start mb-2">
              <div>
                <h3 className="font-semibold">{result.title}</h3>
                <div className="flex gap-2 mt-1">
                  <span className="px-2 py-0.5 rounded text-xs bg-gray-200 dark:bg-gray-700">
                    {result.sourceType}
                  </span>
                  <span className="text-xs text-gray-500">
                    Similarity: {(result.similarity * 100).toFixed(1)}%
                  </span>
                  {result.publishedAt && (
                    <span className="text-xs text-gray-500">
                      {new Date(result.publishedAt).toLocaleDateString('ko-KR')}
                    </span>
                  )}
                </div>
              </div>
              {result.url && (
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:underline"
                >
                  Open
                </a>
              )}
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
              {result.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
