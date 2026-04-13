#!/usr/bin/env npx tsx
/**
 * R6 보강 롤백 → R2 상태 복원
 * [별칭: ...] 헤더가 있는 포인트의 content 복원 + dense/sparse 재생성
 */

import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_URL = process.env.QDRANT_URL || 'http://192.168.0.67:12333';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.0.81:11434';
const COLLECTION = process.env.QDRANT_COLLECTION || 'rag_production';
const BATCH_SIZE = 10;

const qdrant = new QdrantClient({ url: QDRANT_URL });

function textToSparse(text: string): { indices: number[]; values: number[] } {
  const words = text.toLowerCase().split(/[\s.,;:!?()[\]{}"'/\\]+/);
  const tf = new Map<number, number>();
  for (const w of words) {
    if (w.length < 2) continue;
    let hash = 0;
    for (let i = 0; i < w.length; i++) {
      hash = ((hash << 5) - hash + w.charCodeAt(i)) & 0x7fffffff;
    }
    tf.set(hash % 1000000, (tf.get(hash % 1000000) || 0) + 1);
  }
  const maxTf = Math.max(...tf.values(), 1);
  const indices = [...tf.keys()];
  const values = indices.map((i) => (tf.get(i) || 0) / maxTf);
  return { indices, values };
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const r = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'bge-m3', input: batch }),
    });
    const d = (await r.json()) as { embeddings: number[][] };
    results.push(...d.embeddings);
  }
  return results;
}

async function main() {
  let fixed = 0;
  let scanned = 0;
  let offset: string | number | undefined = undefined;
  const PREFIX = /^\[별칭:[^\]]*\]\n/;

  console.log(`\n=== R2 상태 복원 (별칭 헤더 제거 + dense/sparse 재생성) ===\n`);

  // 1. 대상 수집
  const targets: Array<{ id: string | number; originalContent: string }> = [];

  while (true) {
    const result = await qdrant.scroll(COLLECTION, {
      limit: 100,
      with_payload: { include: ['content'] },
      ...(offset ? { offset } : {}),
    });
    if (result.points.length === 0) break;

    for (const point of result.points) {
      scanned++;
      const content = ((point.payload ?? {}) as Record<string, unknown>).content as string || '';
      if (PREFIX.test(content)) {
        targets.push({ id: point.id, originalContent: content.replace(PREFIX, '') });
      }
    }

    offset = result.next_page_offset as string | number | undefined;
    if (!offset) break;
    if (scanned % 50000 === 0) console.log(`  스캔: ${scanned}건, 대상: ${targets.length}건`);
  }

  console.log(`\n스캔 완료: ${targets.length}건 복원 대상\n`);

  // 2. 배치 복원
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const contents = batch.map((t) => t.originalContent);

    const embeddings = await embedBatch(contents);

    for (let j = 0; j < batch.length; j++) {
      await qdrant.overwritePayload(COLLECTION, {
        points: [batch[j].id],
        payload: { content: batch[j].originalContent },
      });
    }

    await qdrant.updateVectors(COLLECTION, {
      points: batch.map((t, j) => ({
        id: t.id,
        vector: {
          dense: embeddings[j],
          text: textToSparse(t.originalContent),
        },
      })),
    });

    fixed += batch.length;
    if (fixed % 100 === 0 || i + BATCH_SIZE >= targets.length) {
      console.log(`  복원: ${fixed}/${targets.length} (${((fixed / targets.length) * 100).toFixed(1)}%)`);
    }
  }

  console.log(`\n=== 완료: ${fixed}건 복원 ===`);
}

main().catch(console.error);
