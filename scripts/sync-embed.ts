#!/usr/bin/env npx tsx
/**
 * 동기식 병렬 임베딩 처리 스크립트
 * Batch API 쿼터 초과 시 대안. batchEmbedContents API로 100건씩 병렬 처리.
 *
 * 사용법:
 *   npx tsx scripts/sync-embed.ts                    # 미처리 청크 전체
 *   npx tsx scripts/sync-embed.ts --limit 50000      # 최대 N건
 *   npx tsx scripts/sync-embed.ts --dry-run           # 대상 건수만 확인
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
const EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const BATCH_SIZE = 100; // batchEmbedContents 최대
const CONCURRENCY = 1;  // 동시 요청 수 (rate limit 방지)
const REQUEST_DELAY = 500; // 요청 간 딜레이 ms
const RETRY_DELAY = 5000;

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

async function getTargetChunks(limit: number): Promise<{ id: string; content: string }[]> {
  const limitClause = limit > 0 ? `LIMIT ${limit}` : '';
  return prisma.$queryRawUnsafe(`
    SELECT dc.id, dc.content
    FROM document_chunks dc
    WHERE dc.embedding IS NULL
    ORDER BY dc.created_at ASC
    ${limitClause}
  `);
}

function sanitize(text: string): string {
  return text
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const requests = texts.map((text) => ({
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text: sanitize(text) }] },
  }));

  for (let retry = 0; retry < 3; retry++) {
    try {
      const res = await fetch(
        `${BASE_URL}/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests }),
        },
      );

      if (res.status === 429) {
        console.warn(`[Embed] 429 rate limit, ${RETRY_DELAY * (retry + 1)}ms 대기...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY * (retry + 1)));
        continue;
      }

      if (!res.ok) {
        const err = await res.text();
        console.error(`[Embed] API 에러: ${res.status} ${err.slice(0, 200)}`);
        return texts.map(() => null);
      }

      const data = await res.json();
      return (data.embeddings ?? []).map((e: { values: number[] }) => e.values ?? null);
    } catch (e) {
      console.error(`[Embed] 요청 실패 (retry ${retry}):`, e);
      await new Promise((r) => setTimeout(r, RETRY_DELAY));
    }
  }
  return texts.map(() => null);
}

async function main() {
  if (!GEMINI_API_KEY) {
    console.error('GOOGLE_API_KEY 환경변수를 설정하세요.');
    process.exit(1);
  }

  const args = parseArgs();
  const chunks = await getTargetChunks(args.limit);
  console.log(`=== 동기식 병렬 임베딩 ===`);
  console.log(`대상: ${chunks.length}건 | 배치: ${BATCH_SIZE}건 | 병렬: ${CONCURRENCY}`);

  if (chunks.length === 0 || args.dryRun) {
    if (args.dryRun) console.log('--dry-run');
    else console.log('처리할 청크 없음');
    await prisma.$disconnect();
    return;
  }

  let saved = 0;
  let failed = 0;
  const startTime = Date.now();

  // BATCH_SIZE(100) × CONCURRENCY(3) = 300건씩 처리
  for (let i = 0; i < chunks.length; i += BATCH_SIZE * CONCURRENCY) {
    const promises: Promise<void>[] = [];

    for (let j = 0; j < CONCURRENCY; j++) {
      const start = i + j * BATCH_SIZE;
      const batch = chunks.slice(start, start + BATCH_SIZE);
      if (batch.length === 0) break;

      promises.push((async () => {
        const texts = batch.map((c) => c.content);
        const embeddings = await embedBatch(texts);

        for (let k = 0; k < batch.length; k++) {
          if (embeddings[k]) {
            const vectorStr = `[${embeddings[k]!.join(',')}]`;
            await prisma.$executeRawUnsafe(
              `UPDATE document_chunks SET embedding = $1::vector WHERE id = $2::uuid`,
              vectorStr,
              batch[k].id,
            );
            saved++;
          } else {
            failed++;
          }
        }
      })());
    }

    await Promise.all(promises);
    await new Promise((r) => setTimeout(r, REQUEST_DELAY));

    const processed = Math.min(i + BATCH_SIZE * CONCURRENCY, chunks.length);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (saved / (Date.now() - startTime) * 1000).toFixed(0);
    if (processed % 3000 === 0 || processed === chunks.length) {
      console.log(`[${elapsed}s] ${processed}/${chunks.length} (${rate}건/초, 성공:${saved} 실패:${failed})`);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n=== 완료 ===`);
  console.log(`${saved}건 임베딩 저장 (${totalTime}초, 실패:${failed})`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
