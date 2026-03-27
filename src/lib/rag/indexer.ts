import { prisma } from '@/lib/prisma';
import { getEmbeddingProvider } from './embedding';
import { summarizeContent } from '@/lib/llm';
import { createHash } from 'crypto';
import { getQdrantClient, getCollectionName, textToSparse } from '@/lib/qdrant';
import type { SourceType, Prisma } from '@prisma/client';

export interface IndexableItem {
  sourceId: string;
  sourceType: SourceType;
  externalId: string;
  url?: string;
  title: string;
  content: string;
  summary?: string;
  metadata?: Prisma.InputJsonValue;
  tags?: string[];
  publishedAt?: Date;
  collectionId?: string;
  projectId?: string;
}

export interface IndexOptions {
  /** true면 요약/임베딩을 스킵하고 문서+청크만 저장 (배치 후처리용) */
  deferAI?: boolean;
}

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

const MIN_CONTENT_LENGTH = 10;
const CHUNK_SIZE = 1500;

/** 줄 단위 청킹 */
function chunkByLines(text: string, maxLen: number): { text: string; index: number }[] {
  const lines = text.split('\n');
  const chunks: { text: string; index: number }[] = [];
  let buf = '';
  let idx = 0;

  for (const line of lines) {
    if (buf.length + line.length + 1 > maxLen && buf.length > 0) {
      chunks.push({ text: buf.trim(), index: idx++ });
      buf = '';
    }
    buf += (buf ? '\n' : '') + line;
  }
  if (buf.trim()) chunks.push({ text: buf.trim(), index: idx });
  return chunks;
}

/** 소스 타입별 스마트 청킹 */
function smartChunk(content: string, _opts: { sourceType: string }): { text: string; index: number }[] {
  if (content.length <= CHUNK_SIZE) return [{ text: content, index: 0 }];
  return chunkByLines(content, CHUNK_SIZE);
}

export async function indexItem(item: IndexableItem, options: IndexOptions = {}): Promise<'new' | 'updated' | 'skipped'> {
  const { deferAI = true } = options;

  // 쓰레기 데이터 필터링: 10자 미만 콘텐츠 제외
  if (item.content.trim().length < MIN_CONTENT_LENGTH) {
    console.warn(`[Indexer] 콘텐츠 너무 짧아 스킵 (${item.content.trim().length}자): ${item.title}`);
    return 'skipped';
  }

  const contentHash = computeHash(item.content);

  // 중복 체크
  const existing = await prisma.document.findUnique({
    where: {
      sourceId_externalId: {
        sourceId: item.sourceId,
        externalId: item.externalId,
      },
    },
  });

  if (existing) {
    if (existing.contentHash === contentHash) {
      return 'skipped';
    }
    // 콘텐츠 변경됨 → 기존 청크 삭제 후 재인덱싱
    await prisma.documentChunk.deleteMany({ where: { documentId: existing.id } });

    // deferAI=false: 동기식 요약 생성
    const summary = deferAI
      ? (item.summary || null)
      : (item.summary || await generateSummary(item.title, item.content, item.sourceType));

    await prisma.document.update({
      where: { id: existing.id },
      data: {
        title: item.title,
        content: item.content,
        contentHash,
        summary,
        metadata: item.metadata ?? {},
        tags: item.tags ?? [],
        publishedAt: item.publishedAt,
        url: item.url,
        projectId: item.projectId,
      },
    });

    // 청크 생성 (요약 있으면 요약 기반, 없으면 원본)
    const chunkContent = summary || item.content;
    if (deferAI) {
      await createChunksOnly(existing.id, chunkContent, item.sourceType);
    } else {
      await createAndEmbedChunks(existing.id, chunkContent, item.sourceType);
    }
    return 'updated';
  }

  // deferAI=false: 동기식 요약 생성
  const summary = deferAI
    ? (item.summary || null)
    : (item.summary || await generateSummary(item.title, item.content, item.sourceType));

  // 신규 문서
  const doc = await prisma.document.create({
    data: {
      sourceId: item.sourceId,
      sourceType: item.sourceType,
      externalId: item.externalId,
      url: item.url,
      title: item.title,
      content: item.content,
      contentHash,
      summary,
      metadata: item.metadata ?? {},
      tags: item.tags ?? [],
      publishedAt: item.publishedAt,
      collectionId: item.collectionId,
      projectId: item.projectId,
    },
  });

  const chunkContent = summary || item.content;
  if (deferAI) {
    // 문서 + 청크만 저장 → 요약/임베딩은 배치로 후처리
    await createChunksOnly(doc.id, chunkContent, item.sourceType);
  } else {
    await createAndEmbedChunks(doc.id, chunkContent, item.sourceType);
  }
  return 'new';
}

async function generateSummary(title: string, content: string, sourceType: string): Promise<string | null> {
  if (content.length < 200) return null;

  try {
    return await summarizeContent(title, content, sourceType);
  } catch (error) {
    console.warn(`[Indexer] 요약 생성 실패: ${title}`, error);
    return null;
  }
}

/** 청크만 생성 (임베딩 없이) - 배치 후처리용 */
async function createChunksOnly(documentId: string, content: string, sourceType: SourceType): Promise<void> {
  const chunks = smartChunk(content, { sourceType });

  console.log(`[Indexer] smartChunk(${sourceType}): ${content.length}자 → ${chunks.length}개 청크`);

  await Promise.all(
    chunks.map((chunk) =>
      prisma.documentChunk.create({
        data: {
          documentId,
          content: chunk.text,
          chunkIndex: chunk.index,
          tokenCount: Math.ceil(chunk.text.length / 4),
        },
      })
    )
  );
}

/** 청크 생성 + 임베딩 + Qdrant 적재 (동기식) */
async function createAndEmbedChunks(documentId: string, content: string, sourceType: SourceType, title?: string): Promise<void> {
  const chunks = smartChunk(content, { sourceType });

  console.log(`[Indexer] smartChunk(${sourceType}): ${content.length}자 → ${chunks.length}개 청크`);

  const createdChunks = await Promise.all(
    chunks.map((chunk) =>
      prisma.documentChunk.create({
        data: {
          documentId,
          content: chunk.text,
          chunkIndex: chunk.index,
          tokenCount: Math.ceil(chunk.text.length / 4),
        },
      })
    )
  );

  // bge-m3 임베딩
  const provider = getEmbeddingProvider();
  const texts = createdChunks.map((c) => c.content);
  const embeddings = await provider.embedBatch(texts);

  // Qdrant 적재
  try {
    const qdrant = getQdrantClient();
    const collection = getCollectionName();

    // 현재 포인트 수로 ID 생성
    const info = await qdrant.getCollection(collection);
    const baseId = info.points_count ?? 0;

    const points = createdChunks.map((chunk, i) => ({
      id: baseId + i,
      vector: {
        dense: embeddings[i],
        text: textToSparse(chunk.content),
      },
      payload: {
        chunk_id: chunk.id,
        content: chunk.content,
        title: title || '',
        source_type: sourceType,
        document_id: documentId,
      },
    }));

    await qdrant.upsert(collection, { points });
    console.log(`[Indexer] Qdrant 적재: ${points.length}개`);
  } catch (error) {
    console.error(`[Indexer] Qdrant 적재 실패:`, error);
    // Qdrant 실패해도 pgvector에는 저장됨
  }

}

export async function getIndexStats(projectId?: string) {
  const docFilter = projectId ? { projectId } : {};

  const [documentCount, chunkCount, sourceBreakdown] = await Promise.all([
    prisma.document.count({ where: docFilter }),
    prisma.documentChunk.count({
      where: projectId ? { document: { projectId } } : undefined,
    }),
    prisma.document.groupBy({
      by: ['sourceType'],
      where: docFilter,
      _count: { id: true },
    }),
  ]);

  return {
    documentCount,
    chunkCount,
    sourceBreakdown: sourceBreakdown.map((s) => ({
      sourceType: s.sourceType,
      count: s._count.id,
    })),
  };
}
