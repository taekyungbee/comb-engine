#!/usr/bin/env npx tsx
/**
 * 일반 Gemini embedContent API로 청크 임베딩 (Batch API quota 초과 시 대안)
 *
 * 사용법:
 *   pnpm embed:inline                              # 전체 미처리
 *   pnpm embed:inline -- --limit 1000              # 최대 1000건
 *   pnpm embed:inline -- --source-type JAVA_SOURCE # 특정 소스만
 *   pnpm embed:inline -- --dry-run                 # 건수만 확인
 *   pnpm embed:inline -- --batch-size 50           # 배치 크기 (기본 100)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
const EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const limitArg = args.find((_, i, a) => a[i - 1] === '--limit');
const limit = limitArg ? parseInt(limitArg, 10) : 0;
const sourceTypeArg = args.find((_, i, a) => a[i - 1] === '--source-type');
const batchSizeArg = args.find((_, i, a) => a[i - 1] === '--batch-size');
const BATCH_SIZE = batchSizeArg ? parseInt(batchSizeArg, 10) : 100;

/** Gemini batchEmbedContents (일반 API, Batch API 아님) — 최대 100건 */
async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const requests = texts.map(text => ({
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text: text.slice(0, 10000) }] },
    taskType: 'RETRIEVAL_DOCUMENT',
  }));

  const response = await fetch(
    `${BASE_URL}/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 429) {
      // rate limit — 잠시 대기 후 재시도
      console.warn(`\n[Rate limit] 60초 대기...`);
      await new Promise(r => setTimeout(r, 60000));
      return embedBatch(texts); // 재시도
    }
    throw new Error(`Gemini API 실패: ${response.status} ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.embeddings.map((e: { values: number[] }) => e.values ?? null);
}

/** 유니코드 정리 */
function sanitize(text: string): string {
  return text
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

async function main() {
  console.log('=== Gemini Inline Embedding ===');
  console.log(`모델: ${EMBEDDING_MODEL} (3072차원)`);
  console.log(`배치 크기: ${BATCH_SIZE}`);

  if (!GEMINI_API_KEY) {
    console.error('GOOGLE_API_KEY 또는 GEMINI_API_KEY 환경변수 필요');
    process.exit(1);
  }

  const sourceFilter = sourceTypeArg ? `AND d.source_type = '${sourceTypeArg}'` : '';
  const limitClause = limit > 0 ? `LIMIT ${limit}` : '';

  const chunks: { id: string; content: string }[] = await prisma.$queryRawUnsafe(`
    SELECT dc.id, dc.content
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE dc.embedding IS NULL
      ${sourceFilter}
    ORDER BY dc.created_at ASC
    ${limitClause}
  `);

  console.log(`대상 청크: ${chunks.length}건`);

  if (isDryRun) {
    await prisma.$disconnect();
    return;
  }

  let saved = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(c => sanitize(c.content));

    try {
      const embeddings = await embedBatch(texts);

      for (let j = 0; j < batch.length; j++) {
        const embedding = embeddings[j];
        if (!embedding) { failed++; continue; }

        const vectorStr = `[${embedding.join(',')}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE document_chunks SET embedding = $1::vector WHERE id = $2::uuid`,
          vectorStr,
          batch[j].id,
        );
        saved++;
      }
    } catch (err) {
      failed += batch.length;
      console.error(`\n[Error] batch ${i}: ${(err as Error).message.slice(0, 100)}`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (saved / (Number(elapsed) || 1)).toFixed(1);
    const eta = saved > 0 ? Math.round((chunks.length - i - batch.length) / Number(rate)) : 0;
    process.stdout.write(`\r  진행: ${i + batch.length}/${chunks.length} | 저장: ${saved} | 실패: ${failed} | ${rate}/s | ETA: ${eta}s`);
  }

  console.log(`\n\n=== 완료 ===`);
  console.log(`저장: ${saved}건, 실패: ${failed}건`);
  console.log(`소요: ${((Date.now() - startTime) / 1000).toFixed(0)}초`);

  await prisma.$disconnect();
}

main().catch(console.error);
