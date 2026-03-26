#!/usr/bin/env npx tsx
/**
 * Ollama nomic-embed-text 로컬 임베딩
 * - API 제한 없음, 무료, 무제한
 * - 768차원 (Gemini 3072d → nomic 768d 전환)
 *
 * 사전 작업: pgvector 컬럼을 768d로 변경해야 함
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = 'bge-m3';
const BATCH_SIZE = 200; // Ollama 배치 (병렬 처리)
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '500000');
const REEMBED = process.argv.includes('--reembed'); // 기존 임베딩도 재처리

async function embedBatch(texts: string[]): Promise<number[][]> {
  const resp = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });

  if (!resp.ok) {
    throw new Error(`Ollama embed failed: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json() as { embeddings: number[][] };
  return data.embeddings;
}

async function main() {
  console.log(`=== 로컬 임베딩 (nomic-embed-text, 768d) ===`);
  console.log(`Ollama: ${OLLAMA_URL}`);
  console.log(`모드: ${REEMBED ? '전체 재임베딩' : '미임베딩만'}`);
  console.log(`Limit: ${LIMIT}`);

  // 1. pgvector 컬럼 차원 변경 → 1024d (bge-m3)
  console.log('\n[1/3] pgvector 컬럼 차원 변경...');
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding`);
    await prisma.$executeRawUnsafe(`ALTER TABLE document_chunks ADD COLUMN embedding vector(1024)`);
    console.log('  컬럼 변경 완료: → vector(1024) (bge-m3)');
  } catch (e) {
    console.log('  컬럼 이미 변경됨 또는 에러:', String(e).slice(0, 100));
  }

  // 2. 인덱스 재생성
  console.log('[2/3] IVFFlat 인덱스 재생성...');
  try {
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS idx_chunks_embedding`);
    // 인덱스는 데이터 삽입 후 생성하는 게 효율적이므로 나중에
    console.log('  기존 인덱스 삭제 완료 (데이터 삽입 후 재생성)');
  } catch (e) {
    console.log('  인덱스 삭제 에러:', String(e).slice(0, 100));
  }

  // 3. 임베딩 처리
  console.log('[3/3] 임베딩 시작...');

  const chunks = await prisma.$queryRaw<Array<{ id: string; content: string }>>`
    SELECT id, content FROM document_chunks
    WHERE embedding IS NULL
    ORDER BY created_at ASC
    LIMIT ${LIMIT}
  `;

  console.log(`  대상 청크: ${chunks.length}개`);

  let processed = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(c => c.content.slice(0, 8000)); // nomic max ~8K

    try {
      const embeddings = await embedBatch(texts);

      // 배치 UPDATE (UNNEST 사용)
      const ids = batch.map(b => b.id);
      const vecs = embeddings.map(e => `[${e.join(',')}]`);
      await prisma.$executeRawUnsafe(
        `UPDATE document_chunks SET embedding = data.vec::vector
         FROM (SELECT UNNEST($1::uuid[]) as id, UNNEST($2::text[]) as vec) as data
         WHERE document_chunks.id = data.id`,
        ids,
        vecs
      );

      processed += batch.length;
      if (processed % 1000 === 0 || i + BATCH_SIZE >= chunks.length) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processed / elapsed;
        const remaining = (chunks.length - processed) / rate;
        console.log(`  [${processed}/${chunks.length}] ${rate.toFixed(0)}/s, 남은 시간: ${(remaining/60).toFixed(1)}분`);
      }
    } catch (err) {
      errors++;
      console.error(`  [에러] batch ${i}: ${String(err).slice(0, 100)}`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // 4. 인덱스 재생성
  console.log('\n인덱스 재생성 중...');
  try {
    await prisma.$executeRawUnsafe(
      `CREATE INDEX idx_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`
    );
    console.log('  IVFFlat 인덱스 생성 완료');
  } catch (e) {
    console.log('  인덱스 생성 에러:', String(e).slice(0, 100));
  }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`\n=== 결과 ===`);
  console.log(`처리: ${processed}/${chunks.length}, 에러: ${errors}`);
  console.log(`소요 시간: ${(totalTime/60).toFixed(1)}분 (${(processed/totalTime).toFixed(0)}/s)`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
