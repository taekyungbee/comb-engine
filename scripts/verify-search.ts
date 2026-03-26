#!/usr/bin/env npx tsx
import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';

const qdrant = new QdrantClient({ url: process.env.QDRANT_URL || 'http://192.168.0.67:12333' });
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
const COLLECTION = process.env.QDRANT_COLLECTION || 'rag_production';

async function embed(text: string): Promise<number[]> {
  const r = await fetch(`${OLLAMA}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'bge-m3', input: [text] }),
  });
  const d = (await r.json()) as { embeddings: number[][] };
  return d.embeddings[0];
}

const queries = [
  { tc: 5, q: 'KOMCA 분배 시스템에서 매체별 분배 순서는?' },
  { tc: 26, q: 'KOMCA 용어사전에서 EPSD의 의미는?' },
  { tc: 11, q: 'TO-BE 시스템의 BillController는 어떤 기능을 제공하는가?' },
  { tc: 7, q: 'AS-IS FIDU.TENV_SVCCD 테이블은 TO-BE에서 어떤 이름으로 변경되었는가?' },
  { tc: 22, q: '승인대장 일괄 출력 API는 어떤 경로인가?' },
];

async function main() {
  for (const { tc, q } of queries) {
    const vec = await embed(q);
    const res = await qdrant.query(COLLECTION, {
      prefetch: [
        { query: vec, using: 'dense' as const, limit: 5 },
      ],
      query: { fusion: 'rrf' as const },
      limit: 3,
      with_payload: true,
    });
    console.log(`\n[TC${tc}] ${q}`);
    for (const p of res.points) {
      const pay = p.payload as Record<string, unknown>;
      const title = (pay?.title as string) || '';
      console.log(`  ${(p.score ?? 0).toFixed(3)}  ${title.slice(0, 70)}`);
    }
  }
}

main().catch(console.error);
