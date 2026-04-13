#!/usr/bin/env npx tsx
/**
 * API_ENDPOINT 문서의 alias 벡터를 한국어 설명으로 강화
 * - title에서 API path 추출
 * - content에서 한국어 설명 첫 문장 추출
 * - "API path + 한국어 설명"을 bge-m3로 임베딩 → alias 벡터 업데이트
 */

import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_URL = process.env.QDRANT_URL || 'http://192.168.0.67:12333';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.0.81:11434';
const COLLECTION = process.env.QDRANT_COLLECTION || 'rag_production_v2';
const BATCH_SIZE = 50;

const qdrant = new QdrantClient({ url: QDRANT_URL, timeout: 120_000 });

async function embed(texts: string[]): Promise<number[][]> {
  const r = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'bge-m3', input: texts }),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}`);
  const d = (await r.json()) as { embeddings: number[][] };
  return d.embeddings;
}

function extractKoreanDesc(content: string): string {
  // [API_ENDPOINT] 헤더 이후 첫 한국어 설명 추출
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // 한국어가 포함된 설명 라인 찾기
    if (/[가-힣]/.test(trimmed) && trimmed.length > 10 && !trimmed.startsWith('[')) {
      return trimmed.slice(0, 200);
    }
  }
  return '';
}

async function main() {
  let updated = 0;
  let offset: string | number | undefined = undefined;
  const startTime = Date.now();

  // API_ENDPOINT 문서만 스크롤
  const countResp = await qdrant.count(COLLECTION, {
    filter: { must: [{ key: 'title', match: { text: 'API_ENDPOINT' } }] },
  });
  const total = countResp.count;

  console.log(`\n=== API_ENDPOINT alias 강화 (${COLLECTION}) ===`);
  console.log(`총 ${total}건\n`);

  while (true) {
    const result = await qdrant.scroll(COLLECTION, {
      filter: { must: [{ key: 'title', match: { text: 'API_ENDPOINT' } }] },
      limit: BATCH_SIZE,
      with_payload: { include: ['title', 'content'] },
      ...(offset ? { offset } : {}),
    });

    if (result.points.length === 0) break;

    // 한국어 설명 추출
    const aliasTexts: string[] = [];
    const validPoints: typeof result.points = [];

    for (const p of result.points) {
      const pay = p.payload as Record<string, unknown>;
      const title = (pay.title as string) || '';
      const content = (pay.content as string) || '';
      const korDesc = extractKoreanDesc(content);

      if (korDesc) {
        // API path + 한국어 설명을 합쳐서 alias 텍스트 생성
        const apiPath = title.replace('[API_ENDPOINT] ', '');
        aliasTexts.push(`${apiPath} ${korDesc}`);
        validPoints.push(p);
      }
    }

    if (validPoints.length > 0) {
      const embeddings = await embed(aliasTexts);

      await qdrant.updateVectors(COLLECTION, {
        points: validPoints.map((p, i) => ({
          id: p.id,
          vector: { alias: embeddings[i] },
        })),
      });
    }

    updated += result.points.length;
    offset = result.next_page_offset as string | number | undefined;

    const elapsed = (Date.now() - startTime) / 60_000;
    console.log(
      `  ${updated}/${total} (${((updated / total) * 100).toFixed(1)}%) | ` +
      `${elapsed.toFixed(1)}분 | valid=${validPoints.length}/${result.points.length}`
    );

    if (!offset) break;
  }

  const elapsed = (Date.now() - startTime) / 60_000;
  console.log(`\n=== 완료: ${updated}건 (${elapsed.toFixed(1)}분) ===`);
}

main().catch(console.error);
