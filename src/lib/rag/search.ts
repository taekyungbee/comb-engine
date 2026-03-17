import { prisma } from '@/lib/prisma';
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
  const { limit = 10, threshold = 0.6, sourceTypes, tags, collectionIds, projectId } = options;

  const provider = getEmbeddingProvider();
  const embedding = await provider.embed(query);
  const vectorStr = `[${embedding.join(',')}]`;

  let whereClause = `dc.embedding IS NOT NULL AND 1 - (dc.embedding <=> $1::vector) >= $2`;
  const params: unknown[] = [vectorStr, threshold];
  let paramIndex = 3;

  if (sourceTypes && sourceTypes.length > 0) {
    const placeholders = sourceTypes.map(() => `$${paramIndex++}`).join(', ');
    whereClause += ` AND d.source_type IN (${placeholders})`;
    params.push(...sourceTypes);
  }

  if (tags && tags.length > 0) {
    whereClause += ` AND d.tags && $${paramIndex++}::text[]`;
    params.push(tags);
  }

  if (collectionIds && collectionIds.length > 0) {
    const placeholders = collectionIds.map(() => `$${paramIndex++}`).join(', ');
    whereClause += ` AND d.collection_id IN (${placeholders})`;
    params.push(...collectionIds);
  }

  if (projectId) {
    whereClause += ` AND d.project_id = $${paramIndex++}`;
    params.push(projectId);
  }

  params.push(limit);

  const results = await prisma.$queryRawUnsafe<SearchResult[]>(
    `
    SELECT
      dc.id as "chunkId",
      dc.document_id as "documentId",
      dc.content,
      1 - (dc.embedding <=> $1::vector) as similarity,
      d.source_type as "sourceType",
      d.title,
      d.url,
      d.published_at as "publishedAt",
      d.collection_id as "collectionId",
      d.project_id as "projectId"
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE ${whereClause}
    ORDER BY dc.embedding <=> $1::vector
    LIMIT $${paramIndex}
    `,
    ...params
  );

  return results;
}
