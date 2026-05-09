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
}

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
 *
 * Response:
 *   { success: true, data: {
 *       dryRun: boolean,
 *       documents: number,
 *       chunks: number,
 *       qdrantDeleted: number,
 *       sampleTitles?: string[]   // dryRun일 때만
 *   }}
 */
async function handler(request: NextRequest) {
  try {
    requireRole(await authenticateRequest(request), 'ADMIN');

    const body = (await request.json()) as DeleteRequest;
    const { tags, documentIds, projectId, sourceType, collectionId, dryRun = false } = body;

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

    // Build where clause
    const where: Prisma.DocumentWhereInput = {};
    if (tags?.length) where.tags = { hasSome: tags };
    if (documentIds?.length) where.id = { in: documentIds };
    if (projectId) where.projectId = projectId;
    if (sourceType) where.sourceType = sourceType;
    if (collectionId) where.collectionId = collectionId;

    // 삭제 대상 + 소속 chunks
    const targets = await prisma.document.findMany({
      where,
      select: {
        id: true,
        title: true,
        chunks: { select: { id: true } },
      },
    });

    const docIds = targets.map((d) => d.id);
    const chunkIds = targets.flatMap((d) => d.chunks.map((c) => c.id));

    if (dryRun) {
      return NextResponse.json({
        success: true,
        data: {
          dryRun: true,
          documents: docIds.length,
          chunks: chunkIds.length,
          sampleTitles: targets.slice(0, 10).map((d) => d.title),
        },
      });
    }

    if (docIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: { dryRun: false, documents: 0, chunks: 0, qdrantDeleted: 0 },
      });
    }

    // Qdrant 정리: chunk_id payload 매칭
    let qdrantDeleted = 0;
    if (chunkIds.length > 0) {
      try {
        const qdrant = getQdrantClient();
        const collection = getCollectionName();
        // Qdrant filter delete는 batch size 제한이 없지만 안전하게 1000개 단위 분할
        const BATCH = 1000;
        for (let i = 0; i < chunkIds.length; i += BATCH) {
          const slice = chunkIds.slice(i, i + BATCH);
          await qdrant.delete(collection, {
            filter: {
              must: [{ key: 'chunk_id', match: { any: slice } }],
            },
            wait: true,
          });
          qdrantDeleted += slice.length;
        }
      } catch (err) {
        console.error('[Delete] Qdrant 삭제 실패 (PostgreSQL은 이어 진행):', err);
        // qdrantDeleted는 0 또는 부분 진행분으로 남음 — 사용자가 차이로 인지
      }
    }

    // PostgreSQL DELETE — cascade로 document_chunks 자동 삭제
    const deleted = await prisma.document.deleteMany({
      where: { id: { in: docIds } },
    });

    return NextResponse.json({
      success: true,
      data: {
        dryRun: false,
        documents: deleted.count,
        chunks: chunkIds.length,
        qdrantDeleted,
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
