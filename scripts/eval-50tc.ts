#!/usr/bin/env npx tsx
/**
 * 50TC 평가 스크립트 — Qdrant Hybrid + Reranker
 * CP/CR을 자체 측정 (LLM Judge 없이, 키워드 매칭 기반)
 */

import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { readFileSync, writeFileSync } from 'fs';

const qdrant = new QdrantClient({ url: process.env.QDRANT_URL || 'http://192.168.0.67:12333' });
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
const RERANKER = process.env.RERANKER_URL || 'http://192.168.0.67:10800';
const COLLECTION = process.env.QDRANT_COLLECTION || 'rag_production';
const TOP_K = 5;

interface TestCase {
  id: number;
  category: string;
  difficulty: string;
  question: string;
  ground_truth: string;
  expected_sources: string[];
}

async function embed(text: string): Promise<number[]> {
  const r = await fetch(`${OLLAMA}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'bge-m3', input: [text] }),
  });
  const d = (await r.json()) as { embeddings: number[][] };
  return d.embeddings[0];
}

function textToSparse(text: string): { indices: number[]; values: number[] } {
  const words = text.toLowerCase().split(/[\s.,;:!?()[\]{}"'/\\→]+/);
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

async function rerank(query: string, docs: string[]): Promise<Array<{ index: number; score: number }>> {
  try {
    const resp = await fetch(`${RERANKER}/rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, documents: docs.map((d) => d.slice(0, 2000)), top_k: TOP_K }),
    });
    if (!resp.ok) return docs.map((_, i) => ({ index: i, score: 1 - i * 0.1 }));
    const data = (await resp.json()) as { results: Array<{ index: number; score: number }> };
    return data.results;
  } catch {
    return docs.map((_, i) => ({ index: i, score: 1 - i * 0.1 }));
  }
}

async function search(query: string): Promise<Array<{ content: string; title: string; score: number }>> {
  const vec = await embed(query);
  const sparse = textToSparse(query);
  const identifiers = query.match(/[A-Z][A-Z0-9_]{3,}(?:-\d+)?/g) || [];

  const hybridResults = await qdrant.query(COLLECTION, {
    prefetch: [
      { query: vec, using: 'dense' as const, limit: 20 },
      { query: sparse, using: 'text' as const, limit: 20 },
    ],
    query: { fusion: 'rrf' as const },
    limit: TOP_K * 2,
    with_payload: true,
  });

  // Keyword filter
  const keywordPoints: Array<{ id: string | number; score: number; payload: Record<string, unknown> }> = [];
  for (const ident of identifiers) {
    try {
      const scrollResult = await qdrant.scroll(COLLECTION, {
        filter: { must: [{ key: 'title', match: { text: ident } }] },
        limit: 5,
        with_payload: true,
      });
      keywordPoints.push(...scrollResult.points.map((p) => ({
        id: p.id, score: 0.5, payload: (p.payload ?? {}) as Record<string, unknown>,
      })));
    } catch { /* ignore */ }
  }

  // 합집합
  const seen = new Set<string | number>();
  const combined: Array<{ content: string; title: string }> = [];
  for (const p of hybridResults.points) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      const pay = (p.payload ?? {}) as Record<string, unknown>;
      combined.push({ content: (pay.content as string) || '', title: (pay.title as string) || '' });
    }
  }
  for (const p of keywordPoints) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      combined.push({ content: (p.payload.content as string) || '', title: (p.payload.title as string) || '' });
    }
  }

  // Reranker
  const reranked = await rerank(query, combined.map((c) => c.content));
  return reranked.map((r) => ({
    ...combined[r.index],
    score: r.score,
  }));
}

/** 간이 CP: GT 키워드가 top-K 중 몇 번째에 처음 등장하는지 (1/rank) */
function calcCP(results: Array<{ content: string }>, gt: string): number {
  const gtKeywords = extractKeywords(gt);
  if (gtKeywords.length === 0) return 0;

  for (let i = 0; i < results.length; i++) {
    const content = results[i].content.toLowerCase();
    const matchCount = gtKeywords.filter((kw) => content.includes(kw.toLowerCase())).length;
    if (matchCount >= gtKeywords.length * 0.5) {
      return 1 / (i + 1); // reciprocal rank
    }
  }
  return 0;
}

/** 간이 CR: GT의 핵심 정보가 top-K 전체에 얼마나 커버되는지 */
function calcCR(results: Array<{ content: string }>, gt: string): number {
  const gtKeywords = extractKeywords(gt);
  if (gtKeywords.length === 0) return 0;

  const allContent = results.map((r) => r.content).join(' ').toLowerCase();
  const matched = gtKeywords.filter((kw) => allContent.includes(kw.toLowerCase())).length;
  return matched / gtKeywords.length;
}

function extractKeywords(text: string): string[] {
  // 식별자 (대문자+숫자+언더스코어)
  const identifiers = text.match(/[A-Z][A-Za-z0-9_]{2,}/g) || [];
  // 한국어 핵심 명사 (2글자 이상)
  const korean = text.match(/[가-힣]{2,}/g) || [];
  // API 경로
  const paths = text.match(/\/api\/[^\s,]+/g) || [];

  const all = [...new Set([...identifiers, ...korean, ...paths])];
  // 불용어 제거
  const stopwords = ['이다', '한다', '있다', '된다', '한다', '관련', '데이터', '위한', '통해', '사용', '처리', '기능', '테이블', '프로시저', '클래스'];
  return all.filter((w) => !stopwords.includes(w) && w.length >= 2);
}

async function main() {
  const testset: TestCase[] = JSON.parse(readFileSync('scripts/eval-testset.json', 'utf-8'));
  console.log(`\n=== 50TC 평가 시작 (Qdrant Hybrid + Reranker) ===\n`);

  const results: Array<{ id: number; category: string; cp: number; cr: number }> = [];

  for (const tc of testset) {
    const searchResults = await search(tc.question);
    const cp = calcCP(searchResults, tc.ground_truth);
    const cr = calcCR(searchResults, tc.ground_truth);

    results.push({ id: tc.id, category: tc.category, cp, cr });

    const status = cp > 0 && cr > 0.5 ? '✅' : cp > 0 || cr > 0 ? '⚠️' : '❌';
    console.log(`[TC${String(tc.id).padStart(2)}] ${status} CP=${cp.toFixed(2)} CR=${cr.toFixed(2)} | ${tc.question.slice(0, 50)}`);
  }

  const avgCP = results.reduce((s, r) => s + r.cp, 0) / results.length;
  const avgCR = results.reduce((s, r) => s + r.cr, 0) / results.length;

  console.log(`\n=== 결과 ===`);
  console.log(`CP: ${avgCP.toFixed(3)} (이전: 0.499)`);
  console.log(`CR: ${avgCR.toFixed(3)} (이전: 0.480)`);
  console.log(`약한 TC (CP=0 AND CR<0.5): ${results.filter((r) => r.cp === 0 && r.cr < 0.5).length}개`);

  // 카테고리별
  const cats = new Map<string, { cp: number[]; cr: number[] }>();
  for (const r of results) {
    if (!cats.has(r.category)) cats.set(r.category, { cp: [], cr: [] });
    cats.get(r.category)!.cp.push(r.cp);
    cats.get(r.category)!.cr.push(r.cr);
  }
  console.log(`\n카테고리별:`);
  for (const [cat, v] of [...cats.entries()].sort()) {
    const catCP = v.cp.reduce((s, x) => s + x, 0) / v.cp.length;
    const catCR = v.cr.reduce((s, x) => s + x, 0) / v.cr.length;
    console.log(`  ${cat.padEnd(20)} CP=${catCP.toFixed(2)} CR=${catCR.toFixed(2)} (${v.cp.length}건)`);
  }

  // 결과 저장
  const output = {
    timestamp: new Date().toISOString(),
    method: 'qdrant_hybrid_reranker_50tc_post_supplement',
    metrics: { CP: avgCP, CR: avgCR },
    per_tc: results,
  };
  writeFileSync('scripts/eval-50tc-post-supplement.json', JSON.stringify(output, null, 2));
  console.log(`\n결과 저장: scripts/eval-50tc-post-supplement.json`);
}

main().catch(console.error);
