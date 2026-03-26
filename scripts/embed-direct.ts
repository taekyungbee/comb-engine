#!/usr/bin/env npx tsx
/**
 * Gemini 임베딩 직접 호출 (Batch API 대신)
 * 100개씩 batchEmbedContents로 처리
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = 'gemini-embedding-2-preview';
const BATCH_SIZE = 100;
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '300000');

async function embedBatch(texts: string[]): Promise<number[][]> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map(text => ({
          model: `models/${MODEL}`,
          content: { parts: [{ text: text.slice(0, 5000) }] },
        })),
      }),
    }
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini embed failed: ${resp.status} ${err}`);
  }

  const data = await resp.json() as { embeddings: Array<{ values: number[] }> };
  return data.embeddings.map(e => e.values);
}

async function main() {
  console.log(`=== 임베딩 직접 처리 (limit: ${LIMIT}) ===`);

  // 임베딩 없는 청크 조회
  const chunks = await prisma.$queryRaw<Array<{ id: string; content: string }>>`
    SELECT id, content FROM document_chunks
    WHERE embedding IS NULL
    ORDER BY created_at ASC
    LIMIT ${LIMIT}
  `;

  console.log(`대상 청크: ${chunks.length}개`);

  let processed = 0;
  let errors = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(c => c.content);

    try {
      const embeddings = await embedBatch(texts);

      // DB 업데이트
      for (let j = 0; j < batch.length; j++) {
        const vec = `[${embeddings[j].join(',')}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE document_chunks SET embedding = $1::vector WHERE id = $2::uuid`,
          vec,
          batch[j].id
        );
      }

      processed += batch.length;
      console.log(`[${processed}/${chunks.length}] ${batch.length}개 처리 완료`);
    } catch (err) {
      errors++;
      console.error(`[에러] batch ${i}: ${err}`);
      // rate limit 대응
      await new Promise(r => setTimeout(r, 5000));
    }

    // 과금 연결 상태 - 최소 대기
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\n=== 결과 ===`);
  console.log(`처리: ${processed}/${chunks.length}`);
  console.log(`에러: ${errors}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
