#!/usr/bin/env npx tsx
/**
 * v2 collection dense 벡터 재임베딩 (최적화)
 * - scroll 500건 → Ollama 한번에 전송 → updateVectors 벌크
 * - retry + 이어하기 지원
 */

import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_URL = process.env.QDRANT_URL || 'http://192.168.0.67:12333';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.0.81:11434';
const COLLECTION = process.env.QDRANT_COLLECTION || 'rag_production_v2';
const SCROLL_BATCH = 500;

const qdrant = new QdrantClient({ url: QDRANT_URL, timeout: 120_000 });

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function embed(texts: string[]): Promise<number[][]> {
  for (let retry = 0; retry < 3; retry++) {
    try {
      const r = await fetch(`${OLLAMA_URL}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'bge-m3', input: texts }),
      });
      if (!r.ok) throw new Error(`Ollama ${r.status}`);
      const d = (await r.json()) as { embeddings: number[][] };
      return d.embeddings;
    } catch (e) {
      if (retry < 2) {
        console.warn(`  [재시도 ${retry + 1}/3] ${e instanceof Error ? e.message : e}`);
        await sleep(3000 * (retry + 1));
      } else throw e;
    }
  }
  throw new Error('unreachable');
}

async function main() {
  let updated = 0;
  let offset: string | number | undefined = undefined;
  const startTime = Date.now();

  const info = await qdrant.getCollection(COLLECTION);
  const total = info.points_count ?? 0;

  console.log(`\n=== dense 재임베딩 (${COLLECTION}) ===`);
  console.log(`총 ${total.toLocaleString()}건, SCROLL_BATCH=${SCROLL_BATCH}\n`);

  while (true) {
    const result = await qdrant.scroll(COLLECTION, {
      limit: SCROLL_BATCH,
      with_payload: { include: ['content'] },
      ...(offset ? { offset } : {}),
    });

    if (result.points.length === 0) break;

    const contents = result.points.map((p) =>
      (((p.payload ?? {}) as Record<string, unknown>).content as string || 'empty').slice(0, 8000)
    );

    const embeddings = await embed(contents);

    await qdrant.updateVectors(COLLECTION, {
      points: result.points.map((p, i) => ({
        id: p.id,
        vector: { dense: embeddings[i] },
      })),
    });

    updated += result.points.length;
    offset = result.next_page_offset as string | number | undefined;

    const elapsed = (Date.now() - startTime) / 60_000;
    const rate = updated / elapsed;
    const remaining = (total - updated) / rate;
    console.log(
      `  ${updated.toLocaleString()}/${total.toLocaleString()} (${((updated / total) * 100).toFixed(1)}%) | ` +
      `${elapsed.toFixed(1)}분 | ~${remaining.toFixed(0)}분 남음 | ${rate.toFixed(0)}건/분`
    );

    if (!offset) break;
  }

  const elapsed = (Date.now() - startTime) / 60_000;
  console.log(`\n=== 완료: ${updated.toLocaleString()}건 (${elapsed.toFixed(1)}분) ===`);
}

main().catch(console.error);
