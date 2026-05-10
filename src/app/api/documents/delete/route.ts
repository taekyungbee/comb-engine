import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, requireRole, AuthError } from '@/lib/api-auth';
import { getQdrantClient, getCollectionName } from '@/lib/qdrant';
import { rateLimitMiddleware } from '@/middleware/rate-limit';
import type { Prisma, SourceType } from '@prisma/client';

const rateLimit = rateLimitMiddleware({ limit: 100, windowMs: 60000 });

interface DeleteRequest {
  tags?: string[];
  documentIds?: string[];
  projectId?: string;
  sourceType?: SourceType;
  collectionId?: string;
  dryRun?: boolean;
  /** 분할 batch 크기 (default 5000, min 100, max 20000). 큰 삭제(수만 건) 시 트랜잭션 timeout 회피. */
  batchSize?: number;
  /** 안전 max iteration (default 200). 무한 루프 방지. */
  maxIterations?: number;
}

const DEFAULT_BATCH = 5000;
const MIN_BATCH = 100;
const MAX_BATCH = 20000;
const DEFAULT_MAX_ITER = 200;

/**
 * POST /api/documents/delete
 *
 * Documents bulk delete (admin only). PostgreSQL cascade로 document_chunks 자동 삭제 + Qdrant points 동기 삭제.
 *
 * Body (filter는 1개 이상 필수):
 *   tags?: string[]              tags 배열 매칭 (any)
 *   documentIds?: string[]       정확한 ID 매칭
 *   projectId?: string           프로젝트 단위
 *   sourceType?: SourceType      타입 단위 (API_INGEST 등)
 *   collectionId?: string        컬렉션 단위
 *   dryRun?: boolean             true면 카운트만 (default false)
 *   batchSize?: number           분할 크기 (default 5000, max 20000) — 큰 삭제 시 timeout 회피
 *   maxIterations?: number       안전 max iteration (default 200)
 *
 * Response:
 *   { success: true, data: {
 *       dryRun: boolean,
 *       documents: number,
 *       chunks: number,
 *       qdrantDeleted: number,
 *       iterations: number,
 *       sampleTitles?: string[]   // dryRun일 때만
 *   }}
 */
async function handler(request: NextRequest) {
  try {
    requireRole(await authenticateRequest(request), 'ADMIN');

    const body = (await request.json()) as DeleteRequest;
    const {
      tags,
      documentIds,
      projectId,
      sourceType,
      collectionId,
      dryRun = false,
      batchSize: rawBatchSize,
      maxIterations: rawMaxIter,
    } = body;

    if (
      !tags?.length &&
      !documentIds?.length &&
      !projectId &&
      !sourceType &&
      !collectionId
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message:
              '최소 한 가지 filter 조건이 필요합니다 (tags / documentIds / projectId / sourceType / collectionId)',
            code: 'MISSING_FILTER',
          },
        },
        { status: 400 }
      );
    }

    const batchSize = Math.max(
      MIN_BATCH,
      Math.min(MAX_BATCH, rawBatchSize ?? DEFAULT_BATCH)
    );
    const maxIter = Math.max(1, rawMaxIter ?? DEFAULT_MAX_ITER);

    // Build where clause
    const where: Prisma.DocumentWhereInput = {};
    if (tags?.length) where.tags = { hasSome: tags };
    if (documentIds?.length) where.id = { in: documentIds };
    if (projectId) where.projectId = projectId;
    if (sourceType) where.sourceType = sourceType;
    if (collectionId) where.collectionId = collectionId;

    // dryRun: 첫 batchSize만 select해서 sample 보여주고, 전체 count는 별도 쿼리
    if (dryRun) {
      const [totalDocs, sample] = await Promise.all([
        prisma.document.count({ where }),
        prisma.document.findMany({
          where,
          select: { id: true, title: true, chunks: { select: { id: true } } },
          take: 10,
        }),
      ]);
      const totalChunks = await prisma.documentChunk.count({
        where: { document: where },
      });
      return NextResponse.json({
        success: true,
        data: {
          dryRun: true,
          documents: totalDocs,
          chunks: totalChunks,
          batchSize,
          estimatedIterations: Math.ceil(totalDocs / batchSize),
          sampleTitles: sample.map((d) => d.title),
        },
      });
    }

    // 분할 삭제 루프 — 매 iter마다 batchSize 만큼 select → Qdrant 삭제 → PG 삭제
    const qdrant = getQdrantClient();
    const collection = getCollectionName();

    let totalDocs = 0;
    let totalChunks = 0;
    let qdrantDeleted = 0;
    let iter = 0;

    while (iter < maxIter) {
      iter++;
      const docs = await prisma.document.findMany({
        where,
        select: { id: true, chunks: { select: { id: true } } },
        take: batchSize,
      });

      if (docs.length === 0) break;

      const docIds = docs.map((d) => d.id);
      const chunkIds = docs.flatMap((d) => d.chunks.map((c) => c.id));

      // Qdrant 정리 (chunk_id payload 매칭) — 한 번에 보냄
      if (chunkIds.length > 0) {
        try {
          await qdrant.delete(collection, {
            filter: { must: [{ key: 'chunk_id', match: { any: chunkIds } }] },
            wait: true,
          });
          qdrantDeleted += chunkIds.length;
        } catch (err) {
          console.error(
            `[Delete iter ${iter}] Qdrant 삭제 실패 (PG는 이어 진행):`,
            err
          );
        }
      }

      // PostgreSQL DELETE (cascade로 chunks 자동)
      const r = await prisma.document.deleteMany({
        where: { id: { in: docIds } },
      });
      totalDocs += r.count;
      totalChunks += chunkIds.length;

      console.log(
        `[Delete iter ${iter}] docs=${r.count} chunks=${chunkIds.length} (cumulative docs=${totalDocs})`
      );

      // batch가 가득 안 찼으면 다음 iter는 비어있음 — 조기 종료
      if (docs.length < batchSize) break;
    }

    return NextResponse.json({
      success: true,
      data: {
        dryRun: false,
        documents: totalDocs,
        chunks: totalChunks,
        qdrantDeleted,
        iterations: iter,
        batchSize,
        truncated: iter >= maxIter,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: { message: error.message, code: 'AUTH_ERROR' } },
        { status: error.statusCode }
      );
    }
    console.error('Delete error:', error);
    return NextResponse.json(
      {
        success: false,
        error: { message: '삭제 처리 중 오류가 발생했습니다.', code: 'INTERNAL_ERROR' },
      },
      { status: 500 }
    );
  }
}

export const POST = rateLimit(handler);
