import { prisma } from '@/lib/prisma';
import { chunkText } from '@/lib/ai-core';
import { embedAndSaveChunks } from './embedding';
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

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function indexItem(item: IndexableItem): Promise<'new' | 'updated' | 'skipped'> {
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
    await prisma.document.update({
      where: { id: existing.id },
      data: {
        title: item.title,
        content: item.content,
        contentHash,
        summary: item.summary,
        metadata: item.metadata ?? {},
        tags: item.tags ?? [],
        publishedAt: item.publishedAt,
        url: item.url,
      },
    });
    await createAndEmbedChunks(existing.id, item.content);
    return 'updated';
  }

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
      summary: item.summary,
      metadata: item.metadata ?? {},
      tags: item.tags ?? [],
      publishedAt: item.publishedAt,
      collectionId: item.collectionId,
    },
  });

  await createAndEmbedChunks(doc.id, item.content);
  return 'new';
}

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
