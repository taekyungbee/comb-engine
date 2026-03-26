#!/usr/bin/env npx tsx
/**
 * 분배 관련 문서 우선 임베딩 (bge-m3 로컬)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = 'bge-m3';
const BATCH_SIZE = 50;
const NUM_WORKERS = 4;

async function embedBatch(texts: string[]): Promise<number[][]> {
  const resp = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!resp.ok) throw new Error(`Ollama error: ${resp.status}`);
  const data = (await resp.json()) as { embeddings: number[][] };
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
    ids, vecs
  );
  return batch.length;
}

async function embedQuery(label: string, sql: string) {
  const PAGE_SIZE = 10000;
  let totalProcessed = 0;
  let totalErrors = 0;
  const startTime = Date.now();

  // 총 수 확인
  const countSql = sql.replace(/SELECT dc\.id, dc\.content/i, 'SELECT COUNT(*)::int as cnt').replace(/ORDER BY[^)]*$/i, '').replace(/LIMIT\s+\d+/i, '');
  const countResult = await prisma.$queryRawUnsafe<Array<{ cnt: number }>>(countSql);
  const total = countResult[0]?.cnt ?? 0;
  console.log(`\n--- ${label}: ${total}개 ---`);
  if (total === 0) return;

  while (true) {
    const chunks = await prisma.$queryRawUnsafe<Array<{ id: string; content: string }>>(
      sql + ` LIMIT ${PAGE_SIZE}`
    );
    if (chunks.length === 0) break;

    const batches: Array<Array<{ id: string; content: string }>> = [];
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      batches.push(chunks.slice(i, i + BATCH_SIZE));
    }

    let batchIdx = 0;
    async function worker(wid: number) {
      while (true) {
        const idx = batchIdx++;
        if (idx >= batches.length) break;
        try {
          totalProcessed += await processBatch(batches[idx]);
        } catch (err) {
          totalErrors++;
          console.error(`  [W${wid}] ${String(err).slice(0, 80)}`);
          await new Promise(r => setTimeout(r, 2000));
        }
        if (totalProcessed % 2000 === 0 && totalProcessed > 0) {
          const rate = totalProcessed / ((Date.now() - startTime) / 1000);
          console.log(`  [${totalProcessed}/${total}] ${rate.toFixed(0)}/s`);
        }
      }
    }
    await Promise.all(Array.from({ length: NUM_WORKERS }, (_, i) => worker(i)));
  }
  console.log(`  완료: ${totalProcessed}개, 에러: ${totalErrors}, ${((Date.now() - startTime) / 1000 / 60).toFixed(1)}분`);
}

async function main() {
  console.log('=== 분배 핵심 우선 → 전체 임베딩 (bge-m3) ===\n');

  // Phase 1: 분배 핵심 프로시저
  await embedQuery('분배 핵심 프로시저', `
    SELECT dc.id, dc.content FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE dc.embedding IS NULL
    AND (d.title LIKE '%SP_DISTR%' OR d.title LIKE '%SP_TRANS_TDIS%' OR d.title LIKE '%TDIS_DISTR%')
    ORDER BY d.title
  `);

  // Phase 2: 나머지 ORACLE_SCHEMA + JAVA_SOURCE
  await embedQuery('Oracle + Java', `
    SELECT dc.id, dc.content FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE dc.embedding IS NULL AND d.source_type IN ('ORACLE_SCHEMA', 'JAVA_SOURCE')
    ORDER BY d.title
  `);

  // Phase 3: API_INGEST
  await embedQuery('API Ingest', `
    SELECT dc.id, dc.content FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE dc.embedding IS NULL AND d.source_type = 'API_INGEST'
    ORDER BY d.title
  `);

  // Phase 4: 나머지 전부
  await embedQuery('나머지', `
    SELECT dc.id, dc.content FROM document_chunks dc
    WHERE dc.embedding IS NULL
    ORDER BY created_at ASC
  `);

  // 인덱스 재생성
  console.log('\n인덱스 재생성...');
  try {
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS idx_chunks_embedding`);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX idx_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`
    );
    console.log('IVFFlat 인덱스 완료');
  } catch (e) { console.log('인덱스 에러:', String(e).slice(0, 80)); }

  const stats: any[] = await prisma.$queryRaw`
    SELECT COUNT(*)::int as total,
           COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END)::int as embedded
    FROM document_chunks
  `;
  console.log(`\n최종: ${stats[0].embedded}/${stats[0].total} 임베딩 완료`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
