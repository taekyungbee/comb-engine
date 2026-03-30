#!/usr/bin/env npx tsx
/**
 * 50TC LLM Judge 평가 스크립트
 * - 검색: Qdrant Hybrid + Reranker (eval-50tc.ts와 동일)
 * - 판정: Gemini API (OpenAI 호환) — CP/CR/Faithfulness/AR 4대 지표
 */

import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { readFileSync, writeFileSync } from 'fs';

// ── Config ──
const QDRANT_URL = process.env.QDRANT_URL || 'http://192.168.0.67:12333';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.0.81:11434';
const RERANKER_URL = process.env.RERANKER_URL || 'http://192.168.0.67:10800';
const COLLECTION = process.env.QDRANT_COLLECTION || 'rag_production';
const ZAI_API_KEY = process.env.ZAI_API_KEY || '';
const ZAI_MODEL = process.env.JUDGE_MODEL || 'glm-5';
const ZAI_BASE_URL = process.env.ZAI_URL || 'https://api.z.ai/api/coding/paas/v4/chat/completions';
const TOP_K = 5;
const CONCURRENCY = 2; // z.ai rate limit 고려

if (!ZAI_API_KEY) {
  console.error('ZAI_API_KEY가 필요합니다.');
  process.exit(1);
}

const qdrant = new QdrantClient({ url: QDRANT_URL });

interface TestCase {
  id: number;
  category: string;
  difficulty: string;
  question: string;
  ground_truth: string;
  expected_sources: string[];
}

interface JudgeResult {
  cp: number; // Context Precision (0~1)
  cr: number; // Context Recall (0~1)
  f: number;  // Faithfulness (0~1)
  ar: number; // Answer Relevancy (0~1)
}

// ── Embedding ──
async function embed(text: string): Promise<number[]> {
  const r = await fetch(`${OLLAMA_URL}/api/embed`, {
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

// ── Reranker ──
async function rerank(query: string, docs: string[]): Promise<Array<{ index: number; score: number }>> {
  try {
    const resp = await fetch(`${RERANKER_URL}/rerank`, {
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

// ── Search (Hybrid + Reranker) ──
async function search(query: string): Promise<Array<{ content: string; title: string; score: number }>> {
  const vec = await embed(query);
  const sparse = textToSparse(query);
  // UPPER_CASE + CamelCase + API path
  const upperCase = query.match(/[A-Z][A-Z0-9_]{3,}(?:-\d+)?/g) || [];
  const camelCase = query.match(/[A-Z][a-z]+(?:[A-Z][a-zA-Z0-9]*)+/g) || [];
  const apiPaths = query.match(/\/api\/v\d+\/[\w/.-]+/g) || [];
  const identifiers = [...new Set([...upperCase, ...camelCase, ...apiPaths])];

  const hybridResults = await qdrant.query(COLLECTION, {
    prefetch: [
      { query: vec, using: 'dense' as const, limit: 20 },
      { query: sparse, using: 'text' as const, limit: 20 },
      { query: vec, using: 'alias' as const, limit: 15 },
    ],
    query: { fusion: 'rrf' as const },
    limit: TOP_K * 2,
    with_payload: true,
  });

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

  const seen = new Set<string | number>();
  const combined: Array<{ content: string; title: string }> = [];

  const addPoint = (id: string | number, content: string, title: string) => {
    if (seen.has(id)) return;
    if (content.trim().length < 10) return;
    seen.add(id);
    combined.push({ content, title });
  };

  for (const p of hybridResults.points) {
    const pay = (p.payload ?? {}) as Record<string, unknown>;
    addPoint(p.id, (pay.content as string) || '', (pay.title as string) || '');
  }
  for (const p of keywordPoints) {
    addPoint(p.id, (p.payload.content as string) || '', (p.payload.title as string) || '');
  }

  const reranked = await rerank(query, combined.map((c) => c.content));

  // Reranker 점수 기반 동적 필터링 (노이즈 제거)
  const RERANKER_RATIO = 0.5;
  const RERANKER_MIN = 0.1;
  const filtered: Array<{ content: string; title: string; score: number }> = [];
  if (reranked.length > 0) {
    const topScore = reranked[0].score;
    for (const r of reranked) {
      if (filtered.length === 0) {
        filtered.push({ ...combined[r.index], score: r.score });
      } else if (
        r.score >= topScore * RERANKER_RATIO &&
        r.score >= RERANKER_MIN &&
        filtered.length < TOP_K
      ) {
        filtered.push({ ...combined[r.index], score: r.score });
      }
    }
  }

  return filtered;
}

// ── LLM Judge ──
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

async function callJudge(prompt: string, retries = 2): Promise<string | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);

      const res = await fetch(ZAI_BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ZAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: ZAI_MODEL,
          messages: [
            { role: 'system', content: 'You are an expert RAG evaluation judge. Always respond with valid JSON only.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 4096,
          temperature: 0.1,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(`  [Judge] HTTP ${res.status}: ${errText.slice(0, 100)}`);
        if (res.status === 429) {
          await sleep(5000 * (i + 1)); // rate limit backoff
          continue;
        }
        return null;
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content
        || data.choices?.[0]?.message?.reasoning_content; // z.ai fallback
      return content ? stripThinking(content) : null;
    } catch (e) {
      if (i < retries) {
        await sleep(2000);
        continue;
      }
      console.error(`  [Judge] Error:`, e instanceof Error ? e.message : e);
      return null;
    }
  }
  return null;
}

function parseJudgeResponse(raw: string): JudgeResult | null {
  try {
    const parsed = JSON.parse(raw);
    return {
      cp: clamp(parsed.context_precision ?? parsed.cp ?? 0),
      cr: clamp(parsed.context_recall ?? parsed.cr ?? 0),
      f: clamp(parsed.faithfulness ?? parsed.f ?? 0),
      ar: clamp(parsed.answer_relevancy ?? parsed.ar ?? 0),
    };
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        return {
          cp: clamp(parsed.context_precision ?? parsed.cp ?? 0),
          cr: clamp(parsed.context_recall ?? parsed.cr ?? 0),
          f: clamp(parsed.faithfulness ?? parsed.f ?? 0),
          ar: clamp(parsed.answer_relevancy ?? parsed.ar ?? 0),
        };
      } catch { return null; }
    }
    return null;
  }
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildJudgePrompt(
  question: string,
  groundTruth: string,
  contexts: Array<{ content: string; title: string }>,
): string {
  const ctxText = contexts
    .map((c, i) => `[Context ${i + 1}] (${c.title})\n${c.content.slice(0, 1500)}`)
    .join('\n\n');

  return `Evaluate the retrieval quality for this RAG query.

## Question
${question}

## Ground Truth Answer
${groundTruth}

## Retrieved Contexts (top-${contexts.length})
${ctxText}

## Evaluation Criteria

Score each metric from 0.0 to 1.0:

1. **context_precision**: Among the retrieved contexts, what fraction of them are relevant to answering the question? (relevant contexts / total contexts)
2. **context_recall**: Does the retrieved context cover all the key information in the ground truth? (covered facts / total facts in ground truth)
3. **faithfulness**: If an answer were generated from only these contexts, would it be factually consistent with the ground truth? (1.0 = all facts supported, 0.0 = contradicted or hallucinated)
4. **answer_relevancy**: How well do these contexts enable answering the specific question asked? (1.0 = directly answers, 0.0 = irrelevant)

Respond with JSON only:
{"context_precision": 0.0, "context_recall": 0.0, "faithfulness": 0.0, "answer_relevancy": 0.0}`;
}

// ── Main ──
async function main() {
  const testset: TestCase[] = JSON.parse(readFileSync('scripts/eval-testset.json', 'utf-8'));
  const startTime = Date.now();

  console.log(`\n=== 50TC LLM Judge 평가 (${ZAI_MODEL}) ===`);
  console.log(`Qdrant: ${QDRANT_URL} | Ollama: ${OLLAMA_URL} | Reranker: ${RERANKER_URL}\n`);

  const results: Array<{ id: number; category: string; cp: number; cr: number; f: number; ar: number }> = [];

  // 동시 실행 제한 처리
  for (let i = 0; i < testset.length; i += CONCURRENCY) {
    const batch = testset.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (tc) => {
        const searchResults = await search(tc.question);
        const prompt = buildJudgePrompt(tc.question, tc.ground_truth, searchResults);
        const raw = await callJudge(prompt);

        if (!raw) {
          console.log(`[TC${String(tc.id).padStart(2)}] ❌ Judge 응답 실패 | ${tc.question.slice(0, 50)}`);
          return { id: tc.id, category: tc.category, cp: 0, cr: 0, f: 0, ar: 0 };
        }

        const scores = parseJudgeResponse(raw);
        if (!scores) {
          console.log(`[TC${String(tc.id).padStart(2)}] ❌ JSON 파싱 실패 | ${tc.question.slice(0, 50)}`);
          return { id: tc.id, category: tc.category, cp: 0, cr: 0, f: 0, ar: 0 };
        }

        const avg = (scores.cp + scores.cr + scores.f + scores.ar) / 4;
        const status = avg >= 0.7 ? '✅' : avg >= 0.4 ? '⚠️' : '❌';
        console.log(
          `[TC${String(tc.id).padStart(2)}] ${status} CP=${scores.cp.toFixed(2)} CR=${scores.cr.toFixed(2)} F=${scores.f.toFixed(2)} AR=${scores.ar.toFixed(2)} | ${tc.question.slice(0, 45)}`,
        );

        return { id: tc.id, category: tc.category, ...scores };
      }),
    );

    results.push(...batchResults);

    // rate limit 보호
    if (i + CONCURRENCY < testset.length) {
      await sleep(1000);
    }
  }

  // ── 결과 집계 ──
  const avg = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / arr.length;
  const avgCP = avg(results.map((r) => r.cp));
  const avgCR = avg(results.map((r) => r.cr));
  const avgF = avg(results.map((r) => r.f));
  const avgAR = avg(results.map((r) => r.ar));
  const overall = (avgCP + avgCR + avgF + avgAR) / 4;

  const duration = (Date.now() - startTime) / 60_000;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`결과 (${ZAI_MODEL}, ${duration.toFixed(1)}분)`);
  console.log(`${'='.repeat(50)}`);
  console.log(`  Context Precision : ${avgCP.toFixed(3)}`);
  console.log(`  Context Recall    : ${avgCR.toFixed(3)}`);
  console.log(`  Faithfulness      : ${avgF.toFixed(3)}`);
  console.log(`  Answer Relevancy  : ${avgAR.toFixed(3)}`);
  console.log(`  OVERALL           : ${overall.toFixed(3)}`);

  // 이전 결과와 비교
  console.log(`\n  이전 (z.ai glm-5, Coding Plan): CP=0.307 CR=0.463 F=0.497 AR=0.514 OVERALL=0.445`);
  console.log(`  이전 (Ragas 20TC, gemini-2.5-flash): CP=0.894 CR=0.950 F=0.848 AR=0.849 OVERALL=0.885`);

  // 카테고리별
  const cats = new Map<string, { cp: number[]; cr: number[]; f: number[]; ar: number[] }>();
  for (const r of results) {
    if (!cats.has(r.category)) cats.set(r.category, { cp: [], cr: [], f: [], ar: [] });
    const c = cats.get(r.category)!;
    c.cp.push(r.cp);
    c.cr.push(r.cr);
    c.f.push(r.f);
    c.ar.push(r.ar);
  }

  console.log(`\n카테고리별:`);
  for (const [cat, v] of [...cats.entries()].sort()) {
    const catAvg = (avg(v.cp) + avg(v.cr) + avg(v.f) + avg(v.ar)) / 4;
    console.log(
      `  ${cat.padEnd(22)} CP=${avg(v.cp).toFixed(2)} CR=${avg(v.cr).toFixed(2)} F=${avg(v.f).toFixed(2)} AR=${avg(v.ar).toFixed(2)} avg=${catAvg.toFixed(2)} (${v.cp.length}건)`,
    );
  }

  // 약한 TC
  const weak = results.filter((r) => (r.cp + r.cr + r.f + r.ar) / 4 < 0.5);
  if (weak.length > 0) {
    console.log(`\n약한 TC (avg < 0.5): ${weak.length}건`);
    for (const w of weak) {
      const tc = testset.find((t) => t.id === w.id)!;
      console.log(`  TC${w.id}: CP=${w.cp.toFixed(2)} CR=${w.cr.toFixed(2)} F=${w.f.toFixed(2)} AR=${w.ar.toFixed(2)} | ${tc.question.slice(0, 50)}`);
    }
  }

  // 결과 저장
  const output = {
    timestamp: new Date().toISOString(),
    judge: `z.ai ${ZAI_MODEL}`,
    testcases: results.length,
    duration_min: duration,
    metrics: { CP: avgCP, CR: avgCR, F: avgF, AR: avgAR },
    overall,
    per_tc: results,
  };
  const outFile = `scripts/eval-50tc-judge-${Date.now()}.json`;
  writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`\n결과 저장: ${outFile}`);
}

main().catch(console.error);
