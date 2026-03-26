#!/usr/bin/env npx tsx
/**
 * bge-m3 병렬 임베딩 - 여러 워커로 동시 처리
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = 'bge-m3';
const BATCH_SIZE = 100;
const NUM_WORKERS = 4;
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '500000');

async function embedBatch(texts: string[]): Promise<number[][]> {
  const resp = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!resp.ok) throw new Error(`Ollama error: ${resp.status}`);
  const data = await resp.json() as { embeddings: number[][] };
  return data.embeddings;
}

async function processBatch(batch: Array<{ id: string; content: string }>): Promise<number> {
  const texts = batch.map(c => c.content.slice(0, 8000));
  const embeddings = await embedBatch(texts);

  const ids = batch.map(b => b.id);
  const vecs = embeddings.map(e => `[${e.join(',')}]`);
  await prisma.$executeRawUnsafe(
    `UPDATE document_chunks SET embedding = data.vec::vector
     FROM (SELECT UNNEST($1::uuid[]) as id, UNNEST($2::text[]) as vec) as data
     WHERE document_chunks.id = data.id`,
    ids,
    vecs
  );
  return batch.length;
}

async function main() {
  console.log(`=== bge-m3 병렬 임베딩 (${NUM_WORKERS} workers, batch ${BATCH_SIZE}) ===`);

  // 컬럼 차원 확인/변경
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding`);
    await prisma.$executeRawUnsafe(`ALTER TABLE document_chunks ADD COLUMN embedding vector(1024)`);
    console.log('컬럼: vector(1024)');
  } catch { console.log('컬럼 이미 존재'); }

  try {
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS idx_chunks_embedding`);
  } catch { /* ignore */ }

  const chunks = await prisma.$queryRaw<Array<{ id: string; content: string }>>`
    SELECT id, content FROM document_chunks
    WHERE embedding IS NULL
    ORDER BY created_at ASC
    LIMIT ${LIMIT}
  `;

  console.log(`대상: ${chunks.length}개\n`);

  let processed = 0;
  let errors = 0;
  const startTime = Date.now();

  // 배치를 미리 분할
  const batches: Array<Array<{ id: string; content: string }>> = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    batches.push(chunks.slice(i, i + BATCH_SIZE));
  }

  // N개 워커가 동시에 처리
  let batchIdx = 0;

  async function worker(workerId: number) {
    while (true) {
      const idx = batchIdx++;
      if (idx >= batches.length) break;

      try {
        const count = await processBatch(batches[idx]);
        processed += count;
      } catch (err) {
        errors++;
        console.error(`  [W${workerId}] 에러: ${String(err).slice(0, 80)}`);
      }

      if (processed % 2000 === 0 && processed > 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processed / elapsed;
        const remaining = (chunks.length - processed) / rate;
        console.log(`  [${processed}/${chunks.length}] ${rate.toFixed(0)}/s, 남은: ${(remaining / 60).toFixed(1)}분`);
      }
    }
  }

  const workers = Array.from({ length: NUM_WORKERS }, (_, i) => worker(i));
  await Promise.all(workers);

  // 인덱스 재생성
  console.log('\n인덱스 생성 중...');
  try {
    await prisma.$executeRawUnsafe(
      `CREATE INDEX idx_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`
    );
    console.log('IVFFlat 인덱스 완료');
  } catch (e) { console.log('인덱스 에러:', String(e).slice(0, 80)); }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`\n=== 결과 ===`);
  console.log(`처리: ${processed}/${chunks.length}, 에러: ${errors}`);
  console.log(`소요: ${(totalTime / 60).toFixed(1)}분 (${(processed / totalTime).toFixed(0)}/s)`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
