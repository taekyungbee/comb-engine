#!/usr/bin/env npx tsx
/**
 * rag_production(원본)의 dense 벡터를 rag_production_v2로 복사
 * - 재임베딩으로 망가진 dense 벡터를 원본으로 복원
 * - sparse/alias 벡터는 건드리지 않음
 */

import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_URL = process.env.QDRANT_URL || 'http://192.168.0.67:12333';
const SRC_COLLECTION = 'rag_production';
const DST_COLLECTION = 'rag_production_v2';
const SCROLL_BATCH = 500;

const qdrant = new QdrantClient({ url: QDRANT_URL, timeout: 120_000 });

async function main() {
  const info = await qdrant.getCollection(SRC_COLLECTION);
  const total = info.points_count ?? 0;

  console.log(`\n=== dense 벡터 복원: ${SRC_COLLECTION} → ${DST_COLLECTION} ===`);
  console.log(`총 ${total.toLocaleString()}건, SCROLL_BATCH=${SCROLL_BATCH}\n`);

  let copied = 0;
  let offset: string | number | undefined = undefined;
  const startTime = Date.now();

  while (true) {
    // 원본에서 dense 벡터 읽기
    const result = await qdrant.scroll(SRC_COLLECTION, {
      limit: SCROLL_BATCH,
      with_payload: false,
      with_vector: ['dense'],
      ...(offset ? { offset } : {}),
    });

    if (result.points.length === 0) break;

    // v2에 dense 벡터 덮어쓰기
    const points = result.points
      .filter((p) => {
        const vec = (p.vector as Record<string, number[]>)?.dense;
        return vec && vec.length > 0;
      })
      .map((p) => ({
        id: p.id,
        vector: { dense: (p.vector as Record<string, number[]>).dense },
      }));

    if (points.length > 0) {
      await qdrant.updateVectors(DST_COLLECTION, { points });
    }

    copied += result.points.length;
    offset = result.next_page_offset as string | number | undefined;

    const elapsed = (Date.now() - startTime) / 60_000;
    const rate = copied / elapsed;
    const remaining = (total - copied) / rate;
    console.log(
      `  ${copied.toLocaleString()}/${total.toLocaleString()} (${((copied / total) * 100).toFixed(1)}%) | ` +
      `${elapsed.toFixed(1)}분 | ~${remaining.toFixed(0)}분 남음 | ${rate.toFixed(0)}건/분`
    );

    if (!offset) break;
  }

  const elapsed = (Date.now() - startTime) / 60_000;
  console.log(`\n=== 완료: ${copied.toLocaleString()}건 (${elapsed.toFixed(1)}분) ===`);
}

main().catch(console.error);
