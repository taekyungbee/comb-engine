import { prisma } from '@/lib/prisma';
import { chunkText } from '@/lib/ai-core';
import { embedAndSaveChunks } from './embedding';
import { summarizeContent } from '@/lib/llm';
import { createHash } from 'crypto';
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
}

export interface IndexOptions {
  /** true면 요약/임베딩을 스킵하고 문서+청크만 저장 (배치 후처리용) */
  deferAI?: boolean;
}

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

const MIN_CONTENT_LENGTH = 10;

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
      },
    });

    // 청크 생성 (요약 있으면 요약 기반, 없으면 원본)
    const chunkContent = summary || item.content;
    if (deferAI) {
      await createChunksOnly(existing.id, chunkContent);
    } else {
      await createAndEmbedChunks(existing.id, chunkContent);
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
    },
  });

  const chunkContent = summary || item.content;
  if (deferAI) {
    // 문서 + 청크만 저장 → 요약/임베딩은 배치로 후처리
    await createChunksOnly(doc.id, chunkContent);
  } else {
    await createAndEmbedChunks(doc.id, chunkContent);
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
async function createChunksOnly(documentId: string, content: string): Promise<void> {
  const chunks = chunkText(content, { chunkSize: 500, overlap: 50 });

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

/** 청크 생성 + 임베딩 (동기식) */
async function createAndEmbedChunks(documentId: string, content: string): Promise<void> {
  const chunks = chunkText(content, { chunkSize: 500, overlap: 50 });

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

  await embedAndSaveChunks(
    createdChunks.map((c) => ({ id: c.id, text: c.content }))
  );
}

export async function getIndexStats() {
  const [documentCount, chunkCount, sourceBreakdown] = await Promise.all([
    prisma.document.count(),
    prisma.documentChunk.count(),
    prisma.document.groupBy({
      by: ['sourceType'],
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
