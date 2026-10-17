#!/usr/bin/env npx tsx
/**
 * Qdrant 전체 재색인 (LAZ-780, PLAN.md Phase 5-1)
 *
 * Postgres `documents` + `document_chunks` 를 기준(truth)으로 대상 컬렉션에 포인트를 다시 만든다.
 *   point id = chunk.id (UUID), payload = src/lib/rag/indexer.ts buildChunkPayload 와 동일
 *   vector   = dense(bge-m3, 청크 content) + text(sparse TF) + alias(bge-m3, getAliasEmbeddingText)
 * 운영 컬렉션은 건드리지 않는다 — 새 컬렉션(--target)에 적재한 뒤 앱 env QDRANT_COLLECTION 을 바꿔 교체한다.
 * 이어하기: 대상 컬렉션에 이미 있는 point id 는 건너뛴다(--resume 기본). 프로젝트별로 순회·집계한다.
 *
 * 사용 (ai-server 에서 nohup, CLAUDE.md "장시간 작업"):
 *   npx tsx scripts/reindex-full.ts --target rag_production_v3 --create          # 컬렉션 생성 + 전체 재색인
 *   npx tsx scripts/reindex-full.ts --target rag_production_v3 --verify          # PG chunk ↔ 포인트 일치 검사만(JSON)
 *   npx tsx scripts/reindex-full.ts --target rag_production_v3 --project <id>    # 한 프로젝트만 ('' 은 project 없음)
 * 환경: DATABASE_URL, QDRANT_URL(기본 http://192.168.0.67:12333), OLLAMA_URL(기본 http://localhost:11434)
 * 확정값(CLAUDE.md): EMBED_BATCH=100, SCROLL_BATCH=500
 */

import { PrismaClient, type SourceType } from '@prisma/client';
import { QdrantClient } from '@qdrant/js-client-rest';
import { textToSparse } from '../src/lib/qdrant';
import { getAliasEmbeddingText } from '../src/lib/rag/aliases';
import { buildChunkPayload } from '../src/lib/rag/indexer';

const QDRANT_URL = process.env.QDRANT_URL || 'http://192.168.0.67:12333';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_BATCH = 100;
const SCROLL_BATCH = 500;
const MAX_EMBED_CHARS = 8000;
const DIM = 1024;

interface Args {
  target: string;
  create: boolean;
  verify: boolean;
  resume: boolean;
  project?: string;
  limit?: number;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const target = get('--target') || process.env.REINDEX_TARGET;
  if (!target) { console.error('--target <collection> 필수'); process.exit(64); }
  return {
    target,
    create: a.includes('--create'),
    verify: a.includes('--verify'),
    resume: !a.includes('--no-resume'),
    project: a.includes('--project') ? (get('--project') ?? '') : undefined,
    limit: get('--limit') ? Number(get('--limit')) : undefined,
  };
}

const prisma = new PrismaClient();
const qdrant = new QdrantClient({ url: QDRANT_URL, timeout: 180_000 });

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH).map((t) => (t || 'empty').slice(0, MAX_EMBED_CHARS));
    let lastErr: unknown;
    for (let retry = 0; retry < 4; retry++) {
      try {
        const r = await fetch(`${OLLAMA_URL}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'bge-m3', input: batch }),
        });
        if (!r.ok) throw new Error(`Ollama ${r.status}`);
        const d = (await r.json()) as { embeddings: number[][] };
        if (!d.embeddings || d.embeddings.length !== batch.length) throw new Error(`Ollama 응답 길이 불일치 ${d.embeddings?.length}/${batch.length}`);
        out.push(...d.embeddings);
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = e;
        console.warn(`  [임베딩 재시도 ${retry + 1}/4] ${e instanceof Error ? e.message : e}`);
        await sleep(3000 * (retry + 1));
      }
    }
    if (lastErr) throw lastErr;
  }
  return out;
}

async function ensureCollection(target: string, create: boolean): Promise<void> {
  const exists = (await qdrant.getCollections()).collections.some((c) => c.name === target);
  if (exists) { console.log(`컬렉션 ${target} 존재 — 그대로 사용`); return; }
  if (!create) { console.error(`컬렉션 ${target} 없음 — --create 를 주거나 먼저 만들 것`); process.exit(65); }
  await qdrant.createCollection(target, {
    vectors: {
      dense: { size: DIM, distance: 'Cosine' },
      alias: { size: DIM, distance: 'Cosine', on_disk: true },
    },
    sparse_vectors: { text: {} },
  });
  // 검색(search.ts) 필터 키: project_id / source_type (match), title (full-text match) + 삭제용 document_id
  for (const [field, schema] of [
    ['project_id', 'keyword'],
    ['source_type', 'keyword'],
    ['document_id', 'keyword'],
    ['chunk_id', 'keyword'],
  ] as const) {
    await qdrant.createPayloadIndex(target, { field_name: field, field_schema: schema, wait: true });
  }
  await qdrant.createPayloadIndex(target, {
    field_name: 'title',
    field_schema: { type: 'text', tokenizer: 'word', lowercase: true, min_token_len: 2, max_token_len: 40 },
    wait: true,
  });
  console.log(`컬렉션 ${target} 생성 (dense/alias ${DIM} cosine, sparse text, payload index 5개)`);
}

/** 대상 컬렉션의 point id 전체 (이어하기·검증용) */
async function loadPointIds(target: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset: string | number | undefined;
  while (true) {
    const r = await qdrant.scroll(target, { limit: 2000, with_payload: false, with_vector: false, ...(offset ? { offset } : {}) });
    for (const p of r.points) ids.add(String(p.id));
    offset = r.next_page_offset as string | number | undefined;
    if (!offset) break;
  }
  return ids;
}

interface ChunkRow {
  id: string;
  content: string;
  documentId: string;
  document: { title: string; sourceType: SourceType; projectId: string | null; collectionId: string | null; url: string | null };
}

async function* iterChunks(project: string | undefined): AsyncGenerator<ChunkRow[]> {
  let cursor: string | undefined;
  const where = project === undefined ? {} : { document: { projectId: project === '' ? null : project } };
  while (true) {
    const rows: ChunkRow[] = await prisma.documentChunk.findMany({
      where,
      take: SCROLL_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        content: true,
        documentId: true,
        document: { select: { title: true, sourceType: true, projectId: true, collectionId: true, url: true } },
      },
    });
    if (rows.length === 0) break;
    yield rows;
    cursor = rows[rows.length - 1].id;
    if (rows.length < SCROLL_BATCH) break;
  }
}

async function reindex(args: Args): Promise<void> {
  await ensureCollection(args.target, args.create);
  const existing = args.resume ? await loadPointIds(args.target) : new Set<string>();
  const totalChunks = await prisma.documentChunk.count(
    args.project === undefined ? undefined : { where: { document: { projectId: args.project === '' ? null : args.project } } },
  );
  console.log(`\n=== 재색인 → ${args.target} | PG 청크 ${totalChunks.toLocaleString()}건, 이미 적재 ${existing.size.toLocaleString()}건 ===`);

  const perProject = new Map<string, { chunks: number; indexed: number; skipped: number }>();
  const bump = (p: string | null, k: 'chunks' | 'indexed' | 'skipped') => {
    const key = p ?? '(none)';
    const e = perProject.get(key) ?? { chunks: 0, indexed: 0, skipped: 0 };
    e[k]++;
    perProject.set(key, e);
  };

  let done = 0;
  let indexed = 0;
  const started = Date.now();
  for await (const rows of iterChunks(args.project)) {
    for (const r of rows) bump(r.document.projectId, 'chunks');
    const todo = rows.filter((r) => !existing.has(r.id));
    for (const r of rows) if (existing.has(r.id)) bump(r.document.projectId, 'skipped');
    if (todo.length > 0) {
      const dense = await embed(todo.map((r) => r.content));
      const alias = await embed(todo.map((r) => getAliasEmbeddingText(r.document.title, r.content)));
      const points = todo.map((r, i) => ({
        id: r.id,
        vector: { dense: dense[i], text: textToSparse(r.content), alias: alias[i] },
        payload: buildChunkPayload({ id: r.id, content: r.content }, r.documentId, r.document.sourceType, {
          title: r.document.title,
          projectId: r.document.projectId,
          collectionId: r.document.collectionId,
          url: r.document.url,
        }),
      }));
      for (let retry = 0; retry < 3; retry++) {
        try { await qdrant.upsert(args.target, { wait: true, points }); break; }
        catch (e) { if (retry === 2) throw e; console.warn(`  [upsert 재시도 ${retry + 1}/3] ${e instanceof Error ? e.message : e}`); await sleep(5000); }
      }
      for (const r of todo) bump(r.document.projectId, 'indexed');
      indexed += todo.length;
    }
    done += rows.length;
    const min = (Date.now() - started) / 60_000;
    const rate = indexed / Math.max(min, 0.01);
    console.log(`  ${done.toLocaleString()}/${totalChunks.toLocaleString()} 처리 | 적재 ${indexed.toLocaleString()} | ${min.toFixed(1)}분 | ${rate.toFixed(0)}건/분`);
    if (args.limit && done >= args.limit) { console.log('--limit 도달, 중단'); break; }
  }

  console.log(`\n=== 완료: ${indexed.toLocaleString()}건 적재 (${((Date.now() - started) / 60_000).toFixed(1)}분) ===`);
  console.log('프로젝트별:', JSON.stringify(Object.fromEntries(perProject)));
  await verify(args);
}

async function verify(args: Args): Promise<void> {
  const pointIds = await loadPointIds(args.target);
  const chunks = await prisma.documentChunk.findMany({ select: { id: true, document: { select: { projectId: true } } } });
  const chunkIds = new Set(chunks.map((c) => c.id));
  let matched = 0;
  const perProject: Record<string, { chunks: number; matched: number }> = {};
  for (const c of chunks) {
    const key = c.document.projectId ?? '(none)';
    perProject[key] ??= { chunks: 0, matched: 0 };
    perProject[key].chunks++;
    if (pointIds.has(c.id)) { matched++; perProject[key].matched++; }
  }
  let extra = 0;
  for (const id of pointIds) if (!chunkIds.has(id)) extra++;
  const info = await qdrant.getCollection(args.target);
  const report = {
    collection: args.target,
    checkedAt: new Date().toISOString(),
    pgChunks: chunks.length,
    points: info.points_count ?? pointIds.size,
    chunksWithPoint: matched,
    matchRate: chunks.length ? Number(((matched / chunks.length) * 100).toFixed(2)) : 0,
    pointsWithoutChunk: extra,
    perProject,
  };
  console.log('VERIFY ' + JSON.stringify(report));
}

async function main() {
  const args = parseArgs();
  try {
    if (args.verify) await verify(args);
    else await reindex(args);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
