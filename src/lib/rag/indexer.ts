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

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

const MIN_CONTENT_LENGTH = 10;

export async function indexItem(item: IndexableItem): Promise<'new' | 'updated' | 'skipped'> {
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

    // V1 요약 생성 (collector가 요약을 제공하지 않은 경우)
    const summary = item.summary || await generateSummary(item.title, item.content, item.sourceType);

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
    // 요약이 있으면 요약 기반으로 임베딩 (1회), 없으면 원본으로
    await createAndEmbedChunks(existing.id, summary || item.content);
    return 'updated';
  }

  // V1 요약 생성 (collector가 요약을 제공하지 않은 경우)
  const summary = item.summary || await generateSummary(item.title, item.content, item.sourceType);

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

  // 요약 기반 임베딩 1회 (V0 원본 저장 + V1 요약으로 임베딩)
  await createAndEmbedChunks(doc.id, summary || item.content);
  return 'new';
}

async function generateSummary(title: string, content: string, sourceType: string): Promise<string | null> {
  // 짧은 콘텐츠는 요약 불필요
  if (content.length < 200) return null;

  try {
    return await summarizeContent(title, content, sourceType);
  } catch (error) {
    console.warn(`[Indexer] 요약 생성 실패: ${title}`, error);
    return null;
  }
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
