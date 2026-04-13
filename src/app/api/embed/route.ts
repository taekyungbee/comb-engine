import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, requireRole, AuthError } from '@/lib/api-auth';
import { getEmbeddingProvider } from '@/lib/rag/embedding';
import { getQdrantClient, getCollectionName, textToSparse } from '@/lib/qdrant';
import { getAliasEmbeddingText } from '@/lib/rag/aliases';
import { rateLimitMiddleware } from '@/middleware/rate-limit';

const rateLimit = rateLimitMiddleware({ limit: 10, windowMs: 60000 });

const BATCH_SIZE = 50;

/**
 * POST /api/embed
 *
 * deferAI=true로 수집된 청크들을 배치로 bge-m3 임베딩 후 Qdrant에 적재
 *
 * Body:
 *   sourceType?: string   — 특정 소스 타입만 처리 (없으면 전체)
 *   projectId?: string    — 특정 프로젝트만 처리
 *   limit?: number        — 처리할 최대 청크 수 (기본 500)
 *   dryRun?: boolean      — true이면 건수만 반환 (실제 임베딩 없음)
 */
async function handler(request: NextRequest) {
  try {
    requireRole(await authenticateRequest(request), 'ADMIN', 'MEMBER');
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: { message: error.message, code: 'AUTH_ERROR' } },
        { status: error.statusCode },
      );
    }
    return NextResponse.json(
      { success: false, error: { message: '인증 실패', code: 'AUTH_ERROR' } },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const { sourceType, projectId, limit = 500, dryRun = false } = body as {
    sourceType?: string;
    projectId?: string;
    limit?: number;
    dryRun?: boolean;
  };

  try {
    // 처리 대상 청크 조회 (sourceType / projectId 필터 적용)
    const chunks = await prisma.documentChunk.findMany({
      where: {
        document: {
          ...(sourceType ? { sourceType: sourceType as never } : {}),
          ...(projectId ? { projectId } : {}),
        },
      },
      select: {
        id: true,
        content: true,
        document: { select: { title: true, sourceType: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(limit, 5000),
    });

    if (dryRun) {
      return NextResponse.json({
        success: true,
        data: { total: chunks.length, dryRun: true },
      });
    }

    // Qdrant에 이미 존재하는 chunk ID 확인 (upsert이므로 실제로는 중복 무방하지만 효율화)
    const qdrant = getQdrantClient();
    const collection = getCollectionName();

    const chunkIds = chunks.map((c) => c.id);

    // 50건씩 Qdrant retrieve로 존재 여부 확인
    const existingIds = new Set<string>();
    for (let i = 0; i < chunkIds.length; i += 200) {
      const batch = chunkIds.slice(i, i + 200);
      try {
        const retrieved = await qdrant.retrieve(collection, { ids: batch, with_payload: false, with_vector: false });
        for (const p of retrieved) {
          existingIds.add(String(p.id));
        }
      } catch {
        // Qdrant 오류 시 전체 재처리 (upsert이므로 안전)
      }
    }

    const pending = chunks.filter((c) => !existingIds.has(c.id));

    if (pending.length === 0) {
      return NextResponse.json({
        success: true,
        data: { total: chunks.length, embedded: 0, skipped: chunks.length, message: '모두 이미 임베딩됨' },
      });
    }

    const provider = getEmbeddingProvider();
    let embedded = 0;
    let failed = 0;

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => c.content);
      const titleMap = batch.map((c) => c.document.title);
      const sourceTypeMap = batch.map((c) => String(c.document.sourceType));

      try {
        const [embeddings, aliasEmbeddings] = await Promise.all([
          provider.embedBatch(texts),
          provider.embedBatch(batch.map((c, j) => getAliasEmbeddingText(titleMap[j], c.content))),
        ]);

        const points = batch.map((chunk, j) => ({
          id: chunk.id,
          vector: {
            dense: embeddings[j],
            text: textToSparse(chunk.content),
            alias: aliasEmbeddings[j],
          },
          payload: {
            chunk_id: chunk.id,
            content: chunk.content,
            title: titleMap[j],
            source_type: sourceTypeMap[j],
          },
        }));

        await qdrant.upsert(collection, { points });
        embedded += batch.length;
      } catch (err) {
        console.error(`[Embed] batch ${i} 실패:`, err);
        failed += batch.length;
      }
    }

    console.log(`[Embed] 완료: ${embedded}개 임베딩, ${failed}개 실패, ${existingIds.size}개 스킵`);

    return NextResponse.json({
      success: true,
      data: {
        total: chunks.length,
        embedded,
        failed,
        skipped: existingIds.size,
      },
    });
  } catch (error) {
    console.error('Embed batch error:', error);
    return NextResponse.json(
      { success: false, error: { message: '배치 임베딩 실패', code: 'INTERNAL_ERROR' } },
      { status: 500 },
    );
  }
}

export const POST = rateLimit(handler);
