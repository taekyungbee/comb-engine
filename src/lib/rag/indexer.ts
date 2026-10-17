import { prisma } from '@/lib/prisma';
import { getEmbeddingProvider } from './embedding';
import { summarizeContent } from '@/lib/llm';
import { createHash } from 'crypto';
import { getQdrantClient, getCollectionName, textToSparse } from '@/lib/qdrant';
import { getAliasEmbeddingText } from './aliases';
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
  /**
   * (sourceId, externalId) 로 못 찾으면 같은 소스의 같은 title 문서(최신 1건)를 이 externalId 로 넘겨받아 갱신한다.
   * 안정 externalId 를 도입하기 전(매 호출 임의 id)에 쌓인 문서를 중복 없이 흡수하기 위한 1회성 이주 경로.
   */
  adoptByTitle?: boolean;
}

export interface IndexOptions {
  /** true면 요약만 스킵 (임베딩은 항상 실행) */
  skipSummary?: boolean;
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

/**
 * Oracle 프로시저/함수를 논리 블록 단위로 분할
 * 분할 기준: PROCEDURE/FUNCTION 헤더, IS/AS 선언부, BEGIN/END, EXCEPTION
 */
function chunkOracleProcedure(content: string): { text: string; index: number }[] {
  // 시그니처 헤더 분리 (CREATE OR REPLACE ... IS/AS 이전)
  const headerMatch = content.match(/^([\s\S]*?(?:PROCEDURE|FUNCTION)\s+\S+[\s\S]*?)(?:\s+(?:IS|AS)\s)/i);
  const chunks: { text: string; index: number }[] = [];
  let idx = 0;

  if (!headerMatch) {
    // 매칭 실패 시 줄 단위 청킹 fallback
    return chunkByLines(content, CHUNK_SIZE);
  }

  const header = headerMatch[1].trim();
  const rest = content.slice(headerMatch[0].length);

  // 헤더 (선언부 포함 시그니처)
  chunks.push({ text: header, index: idx++ });

  // EXCEPTION 블록 분리
  const exceptionIdx = rest.search(/\bEXCEPTION\b/i);
  const bodyPart = exceptionIdx >= 0 ? rest.slice(0, exceptionIdx) : rest;
  const exceptionPart = exceptionIdx >= 0 ? rest.slice(exceptionIdx) : '';

  // 본문 — 1500자 초과 시 줄 단위 청킹
  if (bodyPart.trim()) {
    const bodyChunks = bodyPart.trim().length <= CHUNK_SIZE
      ? [{ text: bodyPart.trim(), index: idx++ }]
      : chunkByLines(bodyPart.trim(), CHUNK_SIZE).map((c) => ({ ...c, index: idx++ }));
    chunks.push(...bodyChunks);
  }

  // EXCEPTION 블록
  if (exceptionPart.trim()) {
    chunks.push({ text: exceptionPart.trim(), index: idx++ });
  }

  return chunks.filter((c) => c.text.length >= 20);
}

/**
 * YouTube 타임스탬프 마커([MM:SS])로 분할 후 CHUNK_SIZE 초과 시 재분할
 * 수집기에서 [MM:SS]\n{text} 형식으로 저장한 자막에 적용
 */
function chunkYouTubeByTimestamp(content: string): { text: string; index: number }[] {
  // [MM:SS] 마커로 구간 분리
  const sections = content.split(/\n(?=\[\d{2}:\d{2}\]\n)/);
  const chunks: { text: string; index: number }[] = [];
  let idx = 0;

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    if (trimmed.length <= CHUNK_SIZE) {
      chunks.push({ text: trimmed, index: idx++ });
    } else {
      // 5분 구간이 너무 긴 경우 줄 단위 재분할 (헤더 보존)
      const headerMatch = trimmed.match(/^(\[\d{2}:\d{2}\]\n)/);
      const header = headerMatch ? headerMatch[1] : '';
      const body = header ? trimmed.slice(header.length) : trimmed;
      const subChunks = chunkByLines(body, CHUNK_SIZE - header.length);
      for (const sub of subChunks) {
        chunks.push({ text: `${header}${sub.text}`, index: idx++ });
      }
    }
  }

  return chunks.length > 0 ? chunks : chunkByLines(content, CHUNK_SIZE);
}

/** 소스 타입별 스마트 청킹 */
function smartChunk(content: string, opts: { sourceType: string }): { text: string; index: number }[] {
  if (content.length <= CHUNK_SIZE) return [{ text: content, index: 0 }];

  // YouTube: [MM:SS] 타임스탬프 마커 기반 분할 (5분 단위 구간)
  if (opts.sourceType === 'YOUTUBE_CHANNEL' && /\[\d{2}:\d{2}\]\n/.test(content)) {
    const ytChunks = chunkYouTubeByTimestamp(content);
    if (ytChunks.length > 1) return ytChunks;
  }

  // Oracle 프로시저/함수: 논리 블록 단위 분할 (DATABASE + ORACLE_SCHEMA 모두 적용)
  if (['DATABASE', 'ORACLE_SCHEMA'].includes(opts.sourceType) && /(?:PROCEDURE|FUNCTION)/i.test(content)) {
    const oracleChunks = chunkOracleProcedure(content);
    if (oracleChunks.length > 1) return oracleChunks;
  }

  return chunkByLines(content, CHUNK_SIZE);
}

export async function indexItem(item: IndexableItem, options: IndexOptions = {}): Promise<'new' | 'updated' | 'skipped'> {
  const { skipSummary = false } = options;

  // 쓰레기 데이터 필터링: 10자 미만 콘텐츠 제외
  if (item.content.trim().length < MIN_CONTENT_LENGTH) {
    console.warn(`[Indexer] 콘텐츠 너무 짧아 스킵 (${item.content.trim().length}자): ${item.title}`);
    return 'skipped';
  }

  const contentHash = computeHash(item.content);

  // 중복 체크
  let existing = await prisma.document.findUnique({
    where: {
      sourceId_externalId: {
        sourceId: item.sourceId,
        externalId: item.externalId,
      },
    },
  });

  // 안정 externalId 이주: 같은 소스·같은 title 의 최신 문서를 이 externalId 로 넘겨받는다
  if (!existing && item.adoptByTitle) {
    const candidate = await prisma.document.findFirst({
      where: { sourceId: item.sourceId, title: item.title },
      orderBy: { collectedAt: 'desc' },
    });
    if (candidate) {
      existing = await prisma.document.update({
        where: { id: candidate.id },
        data: { externalId: item.externalId },
      });
      console.log(`[Indexer] externalId 이주: "${item.title}" ${candidate.externalId ?? '(none)'} → ${item.externalId}`);
    }
  }

  if (existing) {
    if (existing.contentHash === contentHash) {
      return 'skipped';
    }
    // 콘텐츠 변경됨 → 기존 청크 삭제 후 재인덱싱
    await prisma.documentChunk.deleteMany({ where: { documentId: existing.id } });

    const summary = skipSummary
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

    const chunkContent = summary || item.content;
    await createAndEmbedChunks(existing.id, chunkContent, item.sourceType, {
      title: item.title,
      projectId: item.projectId ?? existing.projectId ?? undefined,
      collectionId: item.collectionId ?? existing.collectionId ?? undefined,
      url: item.url ?? existing.url ?? undefined,
    });
    return 'updated';
  }

  const summary = skipSummary
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
  await createAndEmbedChunks(doc.id, chunkContent, item.sourceType, {
    title: item.title,
    projectId: item.projectId,
    collectionId: item.collectionId,
    url: item.url,
  });
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

export interface ChunkPayloadContext {
  title?: string;
  projectId?: string | null;
  collectionId?: string | null;
  url?: string | null;
}

/**
 * Qdrant 포인트 payload — 검색(search.ts)이 읽는 키와 재색인 스크립트(scripts/reindex-full.ts)가 같은 형식을 쓴다.
 * project_id 는 검색의 프로젝트 필터 키이므로 반드시 넣는다(없으면 생략).
 */
export function buildChunkPayload(
  chunk: { id: string; content: string },
  documentId: string,
  sourceType: SourceType,
  ctx: ChunkPayloadContext,
): Record<string, unknown> {
  return {
    chunk_id: chunk.id,
    content: chunk.content,
    title: ctx.title || '',
    source_type: sourceType,
    document_id: documentId,
    ...(ctx.projectId ? { project_id: ctx.projectId } : {}),
    ...(ctx.collectionId ? { collection_id: ctx.collectionId } : {}),
    ...(ctx.url ? { url: ctx.url } : {}),
  };
}

/** 청크 생성 + 임베딩 + Qdrant 적재 */
async function createAndEmbedChunks(
  documentId: string,
  content: string,
  sourceType: SourceType,
  ctx: ChunkPayloadContext,
): Promise<void> {
  const title = ctx.title;
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

  // alias 벡터용 임베딩 (코드명↔한국어 별칭 브릿지)
  const aliasTexts = createdChunks.map((c) => getAliasEmbeddingText(title || '', c.content));
  const aliasEmbeddings = await provider.embedBatch(aliasTexts);

  // Qdrant 적재
  try {
    const qdrant = getQdrantClient();
    const collection = getCollectionName();

    // chunk.id (UUID)를 Qdrant 포인트 ID로 사용 — 레이스 컨디션 없음, upsert 안전
    const points = createdChunks.map((chunk, i) => ({
      id: chunk.id,
      vector: {
        dense: embeddings[i],
        text: textToSparse(chunk.content),
        alias: aliasEmbeddings[i],
      },
      payload: buildChunkPayload(chunk, documentId, sourceType, ctx),
    }));

    await qdrant.upsert(collection, { points });
    console.log(`[Indexer] Qdrant 적재: ${points.length}개`);
  } catch (error) {
    console.error(`[Indexer] Qdrant 적재 실패:`, error);
    // Qdrant 실패해도 pgvector에는 저장됨
  }

}

/**
 * 문서 삭제 — Qdrant 포인트(document_id 필터) 먼저, 그 다음 Postgres(청크는 cascade).
 * 수집기 전체 동기화에서 사라진 항목 정리용. Qdrant 삭제 실패는 던진다(Postgres 만 지워 고아를 만들지 않기 위해).
 */
export async function deleteDocuments(documentIds: string[]): Promise<{ documents: number; qdrantFiltered: number }> {
  if (documentIds.length === 0) return { documents: 0, qdrantFiltered: 0 };
  const qdrant = getQdrantClient();
  const collection = getCollectionName();
  const BATCH = 200;
  for (let i = 0; i < documentIds.length; i += BATCH) {
    const ids = documentIds.slice(i, i + BATCH);
    await qdrant.delete(collection, {
      wait: true,
      filter: { must: [{ key: 'document_id', match: { any: ids } }] },
    });
  }
  const res = await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
  console.log(`[Indexer] 문서 삭제: ${res.count}개 (Qdrant document_id 필터 ${documentIds.length}건)`);
  return { documents: res.count, qdrantFiltered: documentIds.length };
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
