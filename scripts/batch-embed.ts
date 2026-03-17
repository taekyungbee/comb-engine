#!/usr/bin/env npx tsx
/**
 * Gemini Batch API를 사용한 대량 임베딩 처리 스크립트
 *
 * 사용법:
 *   pnpm batch:embed                                  # 인라인 모드 (기본)
 *   pnpm batch:embed -- --mode file                   # 파일 모드 (JSONL 업로드)
 *   pnpm batch:embed -- --limit 1000                  # 최대 1000건
 *   pnpm batch:embed -- --source-type GIT_CLONE       # 특정 소스 타입만
 *   pnpm batch:embed -- --reembed                     # 기존 임베딩도 재처리
 *   pnpm batch:embed -- --dry-run                     # 대상 건수만 확인
 *
 * 환경변수: GOOGLE_API_KEY 또는 GEMINI_API_KEY, DATABASE_URL
 *
 * 모드:
 *   inline (기본) - 파일 없이 직접 요청. 간편하고 빠름.
 *   file         - JSONL 파일 업로드. 대량 데이터(수만 건+)에 적합.
 *
 * Batch API 장점: 비용 50% 절감, RPM 제한 우회
 */

import { PrismaClient } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const prisma = new PrismaClient();
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
const EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const POLL_INTERVAL = 5_000;
const MAX_POLL_TIME = 24 * 60 * 60 * 1000;

interface Args {
  mode: 'inline' | 'file';
  limit: number;
  sourceType?: string;
  reembed: boolean;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = { mode: 'inline', limit: 0, reembed: false, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--mode': result.mode = args[++i] as 'inline' | 'file'; break;
      case '--limit': result.limit = parseInt(args[++i], 10); break;
      case '--source-type': result.sourceType = args[++i]; break;
      case '--reembed': result.reembed = true; break;
      case '--dry-run': result.dryRun = true; break;
    }
  }
  return result;
}

async function getTargetChunks(args: Args): Promise<{ id: string; content: string }[]> {
  const whereClause = args.reembed ? '1=1' : 'dc.embedding IS NULL';
  const sourceFilter = args.sourceType ? `AND d.source_type = '${args.sourceType}'` : '';
  const limitClause = args.limit > 0 ? `LIMIT ${args.limit}` : '';

  return prisma.$queryRawUnsafe(`
    SELECT dc.id, dc.content
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE ${whereClause} ${sourceFilter}
    ORDER BY dc.created_at ASC
    ${limitClause}
  `);
}

async function waitForJob(client: GoogleGenAI, jobName: string): Promise<Awaited<ReturnType<typeof client.batches.get>>> {
  const startTime = Date.now();
  while (Date.now() - startTime < MAX_POLL_TIME) {
    const job = await client.batches.get({ name: jobName });
    const state = job.state?.toString() || 'UNKNOWN';
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`[Batch] 상태: ${state} (${elapsed}초 경과)`);

    if (state === 'JOB_STATE_SUCCEEDED') return job;
    if (state === 'JOB_STATE_FAILED' || state === 'JOB_STATE_CANCELLED') {
      throw new Error(`배치 작업 실패: ${job.error ? JSON.stringify(job.error) : state}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error('배치 작업 시간 초과 (24시간)');
}

async function saveEmbeddings(chunks: { id: string }[], embeddings: (number[] | null)[]): Promise<number> {
  let saved = 0;
  for (let i = 0; i < embeddings.length && i < chunks.length; i++) {
    const embedding = embeddings[i];
    if (!embedding) continue;

    const vectorStr = `[${embedding.join(',')}]`;
    await prisma.$executeRawUnsafe(
      `UPDATE document_chunks SET embedding = $1::vector WHERE id = $2::uuid`,
      vectorStr,
      chunks[i].id,
    );
    saved++;
    if (saved % 100 === 0) console.log(`[Batch] ${saved}건 저장 완료...`);
  }
  return saved;
}

// ── 인라인 모드 ──
async function runInline(client: GoogleGenAI, chunks: { id: string; content: string }[]): Promise<number> {
  const contents = chunks.map((c) => c.content);

  console.log('[Batch] 배치 작업 생성 중 (인라인)...');
  const batchJob = await client.batches.createEmbeddings({
    model: EMBEDDING_MODEL,
    src: {
      inlinedRequests: { contents },
    },
    config: {
      displayName: `rag-embed-inline-${new Date().toISOString().slice(0, 16)}`,
    },
  });
  console.log(`[Batch] 작업 생성 완료: ${batchJob.name}`);

  const completedJob = await waitForJob(client, batchJob.name!);
  const responses = completedJob.dest?.inlinedEmbedContentResponses;
  if (!responses?.length) {
    console.error('[Batch] 인라인 응답이 없습니다.');
    return 0;
  }

  console.log(`[Batch] ${responses.length}건 응답 수신. DB 저장 중...`);
  const embeddings = responses.map((r) => r.response?.embedding?.values ?? null);
  return saveEmbeddings(chunks, embeddings);
}

// ── 파일 모드 ──
async function runFile(client: GoogleGenAI, chunks: { id: string; content: string }[]): Promise<number> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'rag-batch-'));

  try {
    // JSONL 생성
    const jsonlPath = join(tmpDir, 'embed_requests.jsonl');
    const lines = chunks.map((chunk) => {
      const sanitized = chunk.content
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
        .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
      const line = JSON.stringify({
        custom_id: chunk.id,
        url: '/v1/embeddings',
        body: {
          model: EMBEDDING_MODEL,
          input: sanitized,
        },
      });
      return line.replace(/\\ud[89a-f][0-9a-f]{2}/gi, '');
    });
    writeFileSync(jsonlPath, lines.join('\n'), 'utf-8');
    const sizeMB = (Buffer.byteLength(lines.join('\n')) / 1024 / 1024).toFixed(1);
    console.log(`[Batch] JSONL 생성: ${lines.length}건, ${sizeMB}MB`);

    // 업로드
    console.log('[Batch] 파일 업로드 중...');
    const uploadedFile = await client.files.upload({
      file: jsonlPath,
      config: { mimeType: 'text/plain' },
    });
    console.log(`[Batch] 업로드 완료: ${uploadedFile.name}`);

    // 배치 작업 생성
    const batchJob = await client.batches.createEmbeddings({
      model: EMBEDDING_MODEL,
      src: { fileName: uploadedFile.name! },
      config: {
        displayName: `rag-embed-file-${new Date().toISOString().slice(0, 16)}`,
      },
    });
    console.log(`[Batch] 작업 생성 완료: ${batchJob.name}`);

    const completedJob = await waitForJob(client, batchJob.name!);

    // 결과 다운로드
    const destFileName = completedJob.dest?.fileName;
    if (!destFileName) throw new Error('결과 파일명을 찾을 수 없습니다.');

    const downloadPath = join(tmpDir, 'results.jsonl');
    await client.files.download({ file: destFileName, downloadPath });

    const resultText = readFileSync(downloadPath, 'utf-8');
    const resultLines = resultText.trim().split('\n').filter(Boolean);

    console.log(`[Batch] ${resultLines.length}건 결과 수신. DB 저장 중...`);

    // chunkId → index 맵
    const idToIndex = new Map(chunks.map((c, i) => [c.id, i]));
    const embeddings: (number[] | null)[] = new Array(chunks.length).fill(null);

    for (const line of resultLines) {
      const result = JSON.parse(line);
      const idx = idToIndex.get(result.custom_id);
      if (idx !== undefined) {
        // OpenAI 호환 형식: response.body.data[0].embedding
        embeddings[idx] = result.response?.body?.data?.[0]?.embedding ?? result.response?.body?.embedding?.values ?? null;
      }
    }

    return saveEmbeddings(chunks, embeddings);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  if (!GEMINI_API_KEY) {
    console.error('GOOGLE_API_KEY 또는 GEMINI_API_KEY 환경변수를 설정하세요.');
    process.exit(1);
  }

  const args = parseArgs();
  console.log('=== Gemini Batch Embedding ===');
  console.log(`모델: ${EMBEDDING_MODEL} (3072차원)`);
  console.log(`모드: ${args.mode} | ${args.reembed ? '전체 재임베딩' : '미처리 청크만'}`);
  if (args.sourceType) console.log(`소스 타입: ${args.sourceType}`);
  if (args.limit) console.log(`최대: ${args.limit}건`);
  console.log('');

  const chunks = await getTargetChunks(args);
  console.log(`[Batch] 대상 청크: ${chunks.length}건`);

  if (chunks.length === 0 || args.dryRun) {
    if (args.dryRun) console.log('[Batch] --dry-run 모드.');
    else console.log('[Batch] 처리할 청크가 없습니다.');
    await prisma.$disconnect();
    return;
  }

  const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const saved = args.mode === 'file'
    ? await runFile(client, chunks)
    : await runInline(client, chunks);

  console.log('');
  console.log('=== 완료 ===');
  console.log(`총 ${saved}건 임베딩 저장 (Batch API 50% 할인 적용)`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
