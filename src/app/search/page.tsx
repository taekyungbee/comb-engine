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
  const [tab, setTab] = useState<'search' | 'upload'>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  // Upload state
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadContent, setUploadContent] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTags, setUploadTags] = useState('');
  const [uploadType, setUploadType] = useState<'text' | 'image'>('text');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState('');

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

  const handleUpload = async () => {
    setUploading(true);
    setUploadResult('');

    try {
      if (uploadType === 'text') {
        if (!uploadTitle.trim() || !uploadContent.trim()) {
          setUploadResult('제목과 내용을 입력하세요.');
          return;
        }

        const res = await fetch('/api/ingest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: uploadTitle,
            content: uploadContent,
            tags: uploadTags ? uploadTags.split(',').map((t) => t.trim()) : [],
          }),
        });
        const data = await res.json();
        if (data.success) {
          setUploadResult('텍스트가 수집되었습니다.');
          setUploadTitle('');
          setUploadContent('');
          setUploadTags('');
        } else {
          setUploadResult(data.error?.message || '오류 발생');
        }
      } else {
        if (!uploadFile || !uploadTitle.trim()) {
          setUploadResult('파일과 제목을 입력하세요.');
          return;
        }

        const formData = new FormData();
        formData.append('file', uploadFile);
        formData.append('title', uploadTitle);
        if (uploadTags) formData.append('tags', uploadTags);

        const res = await fetch('/api/ingest', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (data.success) {
          setUploadResult('이미지가 수집되었습니다.');
          setUploadTitle('');
          setUploadFile(null);
          setUploadTags('');
        } else {
          setUploadResult(data.error?.message || '오류 발생');
        }
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setTab('search')}
          className={`text-lg font-bold ${tab === 'search' ? '' : 'text-gray-400'}`}
        >
          Vector Search
        </button>
        <button
          onClick={() => setTab('upload')}
          className={`text-lg font-bold ${tab === 'upload' ? '' : 'text-gray-400'}`}
        >
          Upload
        </button>
      </div>

      {tab === 'search' ? (
        <>
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
        </>
      ) : (
        <div className="card p-6 max-w-2xl">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setUploadType('text')}
              className={`px-3 py-1 text-sm rounded ${uploadType === 'text' ? 'bg-blue-100 text-blue-700' : 'text-gray-500'}`}
            >
              텍스트
            </button>
            <button
              onClick={() => setUploadType('image')}
              className={`px-3 py-1 text-sm rounded ${uploadType === 'image' ? 'bg-blue-100 text-blue-700' : 'text-gray-500'}`}
            >
              이미지
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-sm text-gray-500 block mb-1">제목</label>
              <input
                type="text"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
              />
            </div>

            {uploadType === 'text' ? (
              <div>
                <label className="text-sm text-gray-500 block mb-1">내용</label>
                <textarea
                  value={uploadContent}
                  onChange={(e) => setUploadContent(e.target.value)}
                  rows={8}
                  className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
                />
              </div>
            ) : (
              <div>
                <label className="text-sm text-gray-500 block mb-1">이미지 파일</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="w-full text-sm"
                />
              </div>
            )}

            <div>
              <label className="text-sm text-gray-500 block mb-1">태그 (콤마 구분)</label>
              <input
                type="text"
                value={uploadTags}
                onChange={(e) => setUploadTags(e.target.value)}
                placeholder="예: react, typescript"
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
              />
            </div>

            <button
              onClick={handleUpload}
              disabled={uploading}
              className="btn-primary w-full py-2"
            >
              {uploading ? '수집 중...' : '수집하기'}
            </button>

            {uploadResult && (
              <p className={`text-sm ${uploadResult.includes('오류') || uploadResult.includes('필요') ? 'text-red-500' : 'text-green-600'}`}>
                {uploadResult}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
