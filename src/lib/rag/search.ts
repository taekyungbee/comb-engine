import { getQdrantClient, getCollectionName, textToSparse } from '@/lib/qdrant';
import { getEmbeddingProvider } from './embedding';
import type { SourceType } from '@prisma/client';

export interface SearchResult {
  chunkId: string;
  documentId: string;
  content: string;
  similarity: number;
  sourceType: string;
  title: string;
  url: string | null;
  publishedAt: string | null;
  collectionId: string | null;
  projectId: string | null;
}

export interface SearchOptions {
  limit?: number;
  threshold?: number;
  sourceTypes?: SourceType[];
  tags?: string[];
  collectionIds?: string[];
  projectId?: string;
}

export async function searchSimilar(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { limit = 10, threshold = 0.3, sourceTypes, projectId } = options;
  const qdrant = getQdrantClient();
  const collection = getCollectionName();

  // bge-m3 임베딩
  const provider = getEmbeddingProvider();
  const queryVector = await provider.embed(query);

  // Sparse vector
  const sparse = textToSparse(query);

  // 키워드 식별자 추출 (KOMCA-1796, TENV_SVCCD 등)
  const identifiers = query.match(/[A-Z][A-Z0-9_]{3,}(?:-\d+)?/g) || [];

  // 필터 조건
  const mustConditions: Array<Record<string, unknown>> = [];
  if (sourceTypes && sourceTypes.length > 0) {
    mustConditions.push({
      key: 'source_type',
      match: { any: sourceTypes },
    });
  }
  if (projectId) {
    mustConditions.push({
      key: 'project_id',
      match: { value: projectId },
    });
  }
  const filter = mustConditions.length > 0 ? { must: mustConditions } : undefined;

  // Dense top-20 + Sparse top-20 → RRF fusion
  const prefetch = [
    {
      query: queryVector,
      using: 'dense' as const,
      limit: 20,
      ...(filter ? { filter } : {}),
    },
    {
      query: sparse,
      using: 'text' as const,
      limit: 20,
      ...(filter ? { filter } : {}),
    },
  ];

  const hybridResults = await qdrant.query(collection, {
    prefetch,
    query: { fusion: 'rrf' as const },
    limit: limit * 2, // reranker 전 후보
    with_payload: true,
  });

  // Keyword filter 결과 추가 (식별자 정확 매칭)
  const keywordPoints: Array<{ id: string | number; score: number; payload?: Record<string, unknown> | null }> = [];
  for (const ident of identifiers) {
    try {
      const scrollResult = await qdrant.scroll(collection, {
        filter: {
          must: [{ key: 'title', match: { text: ident } }],
        },
        limit: 5,
        with_payload: true,
      });
      keywordPoints.push(...scrollResult.points.map((p) => ({ ...p, score: 0.5 })));
    } catch {
      // 필터 검색 실패 무시
    }
  }



  // 합집합 (ID 중복 제거)
  const seenIds = new Set<string | number>();
  const combined: CandidatePoint[] = [];

  for (const p of hybridResults.points) {
    if (!seenIds.has(p.id)) {
      seenIds.add(p.id);
      combined.push({
        id: p.id,
        score: p.score ?? 0,
        payload: (p.payload ?? {}) as Record<string, unknown>,
      });
    }
  }
  for (const p of keywordPoints) {
    if (!seenIds.has(p.id)) {
      seenIds.add(p.id);
      combined.push({
        id: p.id,
        score: p.score,
        payload: (p.payload ?? {}) as Record<string, unknown>,
      });
    }
  }

  // 빈 content 제거 (노이즈)
  const validCombined = combined.filter((p) => {
    const content = (p.payload.content as string) || '';
    return content.trim().length >= 10;
  });

  // Reranker로 최종 순위 결정 (넉넉히 가져온 뒤 점수 기반 필터링)
  const reranked = await rerank(query, validCombined, limit * 2);

  // Reranker 점수 기반 동적 필터링
  // - top-1은 항상 포함
  // - 나머지는 top-1 대비 30% 이상인 것만 포함 (노이즈 제거)
  const RERANKER_RATIO_THRESHOLD = 0.5;
  const RERANKER_MIN_SCORE = 0.1; // sigmoid 기반 절대 최소
  const filtered: CandidatePoint[] = [];
  if (reranked.length > 0) {
    const topScore = reranked[0].score;
    for (const point of reranked) {
      if (filtered.length === 0) {
        filtered.push(point); // top-1 항상 포함
      } else if (
        point.score >= topScore * RERANKER_RATIO_THRESHOLD &&
        point.score >= RERANKER_MIN_SCORE &&
        filtered.length < limit
      ) {
        filtered.push(point);
      }
    }
  }

  // SearchResult로 변환 (제어 문자 제거)
  // eslint-disable-next-line no-control-regex
  const sanitize = (s: string) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

  const results: SearchResult[] = filtered.map((point) => ({
    chunkId: (point.payload.chunk_id as string) || String(point.id),
    documentId: (point.payload.document_id as string) || '',
    content: sanitize((point.payload.content as string) || ''),
    similarity: Math.min(1, Math.max(0, point.score)),
    sourceType: (point.payload.source_type as string) || '',
    title: (point.payload.title as string) || '',
    url: null,
    publishedAt: null,
    collectionId: null,
    projectId: (point.payload.project_id as string) || null,
  }));

  return results.filter((r) => r.similarity >= threshold || identifiers.length > 0);
}

// ── Reranker (bge-reranker-v2-m3 서비스) ──

const RERANKER_URL = process.env.RERANKER_URL || 'http://localhost:10800';

interface CandidatePoint {
  id: string | number;
  score: number;
  payload: Record<string, unknown>;
}

async function rerank(
  query: string,
  candidates: CandidatePoint[],
  topK: number
): Promise<CandidatePoint[]> {
  if (candidates.length === 0) return [];

  try {
    const documents = candidates.map(
      (c) => ((c.payload.content as string) || '').slice(0, 2000)
    );

    const resp = await fetch(`${RERANKER_URL}/rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, documents, top_k: topK }),
    });

    if (!resp.ok) {
      console.warn(`[Search] Reranker 실패 (${resp.status}), hybrid 점수 사용`);
      return candidates.slice(0, topK);
    }

    const data = (await resp.json()) as {
      results: Array<{ index: number; score: number }>;
    };

    return data.results.map((r) => ({
      ...candidates[r.index],
      score: r.score,
    }));
  } catch {
    // Reranker 서비스 다운 시 fallback: hybrid 점수 그대로
    console.warn('[Search] Reranker 서비스 연결 실패, hybrid 점수 사용');
    return candidates.slice(0, topK);
  }
}
