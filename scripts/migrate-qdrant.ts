#!/usr/bin/env npx tsx
/**
 * Qdrant → pgvector 마이그레이션 스크립트
 *
 * outsource-hub Qdrant의 komca 컬렉션을 rag-collector pgvector로 이관
 *
 * 사용법:
 *   npx tsx scripts/migrate-qdrant.ts                 # 전체 마이그레이션
 *   npx tsx scripts/migrate-qdrant.ts --dry-run       # 건수만 확인
 *   npx tsx scripts/migrate-qdrant.ts --limit 1000    # 테스트 (1000건)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const QDRANT_URL = process.env.QDRANT_URL || 'http://192.168.0.67:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || '';
const COLLECTION = 'komca';
const SCROLL_SIZE = 100;

interface Args {
  limit: number;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = { limit: 0, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit': result.limit = parseInt(args[++i], 10); break;
      case '--dry-run': result.dryRun = true; break;
    }
  }
  return result;
}

interface QdrantPoint {
  id: string;
  payload: {
    chunkId: string;
    documentId: string;
    sourceId: string;
    side: string;
    environment?: string;
    sourceType: string;
    title: string;
    content: string;
  };
  vector: number[];
}

async function qdrantScroll(offset: string | null, limit: number): Promise<{ points: QdrantPoint[]; nextOffset: string | null }> {
  const body: Record<string, unknown> = {
    limit,
    with_payload: true,
    with_vector: true,
  };
  if (offset) body.offset = offset;

  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points/scroll`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': QDRANT_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Qdrant scroll error: ${res.status}`);
  const data = await res.json();
  return {
    points: data.result.points,
    nextOffset: data.result.next_page_offset || null,
  };
}

async function ensureSource(): Promise<string> {
  // KOMCA AS-IS 소스 확인 또는 생성
  const existing = await prisma.collectorSource.findFirst({
    where: { name: 'KOMCA AS-IS (Qdrant 마이그레이션)' },
  });
  if (existing) return existing.id;

  const source = await prisma.collectorSource.create({
    data: {
      name: 'KOMCA AS-IS (Qdrant 마이그레이션)',
      type: 'API_INGEST',
      config: {},
      tags: ['komca', 'as-is', 'qdrant-migration'],
      enabled: false,
    },
  });
  return source.id;
}

async function main() {
  if (!QDRANT_API_KEY) {
    console.error('QDRANT_API_KEY 환경변수를 설정하세요.');
    process.exit(1);
  }

  const args = parseArgs();
  console.log('=== Qdrant → pgvector 마이그레이션 ===');
  console.log(`Qdrant: ${QDRANT_URL}/collections/${COLLECTION}`);
  if (args.limit) console.log(`최대: ${args.limit}건`);
  console.log('');

  // 1. 전체 건수 확인
  const infoRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, {
    headers: { 'api-key': QDRANT_API_KEY },
  });
  const info = await infoRes.json();
  const totalPoints = info.result.points_count;
  console.log(`[Qdrant] 전체: ${totalPoints.toLocaleString()}건`);

  if (args.dryRun) {
    console.log('--dry-run 모드.');
    await prisma.$disconnect();
    return;
  }

  // 2. pgvector 소스 준비
  const sourceId = await ensureSource();
  console.log(`[pgvector] sourceId: ${sourceId}`);

  // 3. Scroll & 마이그레이션
  let offset: string | null = null;
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  const startTime = Date.now();
  const maxItems = args.limit || Infinity;

  while (migrated + skipped < maxItems) {
    const batchSize = Math.min(SCROLL_SIZE, maxItems - migrated - skipped);
    const { points, nextOffset } = await qdrantScroll(offset, batchSize);

    if (points.length === 0) break;

    for (const point of points) {
      if (migrated + skipped >= maxItems) break;

      const p = point.payload;
      const externalId = `qdrant_${p.chunkId || point.id}`;

      try {
        // 중복 체크
        const existing = await prisma.document.findUnique({
          where: { sourceId_externalId: { sourceId, externalId } },
        });

        if (existing) {
          skipped++;
          continue;
        }

        // 문서 생성
        const doc = await prisma.document.create({
          data: {
            sourceId,
            sourceType: 'API_INGEST',
            externalId,
            title: p.title || 'Untitled',
            content: p.content || '',
            contentHash: require('crypto').createHash('sha256').update(p.content || '').digest('hex'),
            metadata: {
              qdrantId: point.id,
              side: p.side,
              environment: p.environment,
              sourceType: p.sourceType,
              originalDocId: p.documentId,
              originalSourceId: p.sourceId,
            },
            tags: ['komca', 'as-is', p.sourceType?.toLowerCase() || 'unknown'],
          },
        });

        // 청크 생성 + 벡터 저장 (이미 임베딩이 있으니 그대로 이관)
        const chunk = await prisma.documentChunk.create({
          data: {
            documentId: doc.id,
            content: p.content || '',
            chunkIndex: 0,
            tokenCount: Math.ceil((p.content || '').length / 4),
          },
        });

        // 벡터 직접 저장
        const vectorStr = `[${point.vector.join(',')}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE document_chunks SET embedding = $1::vector WHERE id = $2::uuid`,
          vectorStr,
          chunk.id,
        );

        migrated++;
      } catch (e) {
        failed++;
        if (failed <= 5) console.warn(`[에러] ${externalId}: ${e}`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (migrated / (Date.now() - startTime) * 1000).toFixed(0);
    if ((migrated + skipped) % 5000 === 0 || !nextOffset) {
      console.log(`[${elapsed}s] 이관:${migrated} 스킵:${skipped} 실패:${failed} (${rate}건/초)`);
    }

    if (!nextOffset) break;
    offset = nextOffset;
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log('');
  console.log('=== 완료 ===');
  console.log(`이관: ${migrated}건 | 스킵: ${skipped}건 | 실패: ${failed}건 (${totalTime}초)`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
