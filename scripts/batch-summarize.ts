#!/usr/bin/env npx tsx
/**
 * Gemini Batch API를 사용한 대량 요약 처리 스크립트
 *
 * 사용법:
 *   pnpm batch:summarize                              # 인라인 모드 (기본)
 *   pnpm batch:summarize -- --mode file               # 파일 모드 (JSONL 업로드)
 *   pnpm batch:summarize -- --limit 500               # 최대 500건
 *   pnpm batch:summarize -- --source-type GIT_CLONE   # 특정 소스 타입만
 *   pnpm batch:summarize -- --dry-run                 # 대상 건수만 확인
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
import { GoogleGenAI, type InlinedRequest } from '@google/genai';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const prisma = new PrismaClient();
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
const SUMMARIZE_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
const POLL_INTERVAL = 5_000;
const MAX_POLL_TIME = 24 * 60 * 60 * 1000;
const MAX_CONTENT_LENGTH = 4000;

interface Args {
  mode: 'inline' | 'file';
  limit: number;
  sourceType?: string;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = { mode: 'inline', limit: 0, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--mode': result.mode = args[++i] as 'inline' | 'file'; break;
      case '--limit': result.limit = parseInt(args[++i], 10); break;
      case '--source-type': result.sourceType = args[++i]; break;
      case '--dry-run': result.dryRun = true; break;
    }
  }
  return result;
}

interface TargetDoc {
  id: string;
  title: string;
  content: string;
  source_type: string;
}

async function getTargetDocs(args: Args): Promise<TargetDoc[]> {
  const sourceFilter = args.sourceType ? `AND source_type = '${args.sourceType}'` : '';
  const limitClause = args.limit > 0 ? `LIMIT ${args.limit}` : '';

  return prisma.$queryRawUnsafe(`
    SELECT id, title, content, source_type
    FROM documents
    WHERE summary IS NULL
      AND LENGTH(content) >= 200
      ${sourceFilter}
    ORDER BY collected_at ASC
    ${limitClause}
  `);
}

/** 깨진 유니코드, 서로게이트 쌍, 제어 문자 제거 */
function sanitizeText(text: string): string {
  return text
    // 홀로 남은 서로게이트 쌍 제거
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    // 널 바이트 및 제어 문자 제거 (탭/줄바꿈 제외)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function buildPrompt(title: string, content: string, sourceType: string): string {
  const sanitized = sanitizeText(content);
  const truncated = sanitized.length > MAX_CONTENT_LENGTH
    ? sanitized.slice(0, MAX_CONTENT_LENGTH) + '...'
    : sanitized;

  return `다음 문서를 요약해주세요.

제목: ${title}
소스 타입: ${sourceType}
내용:
${truncated}

요약 규칙:
- 핵심 내용을 3~5줄로 요약
- 기술 용어는 원문 유지
- 불릿포인트 형식 ("- 요약1\\n- 요약2")
- 코드 파일이면 주요 기능/클래스/패턴을 설명`;
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

async function saveSummaries(docs: TargetDoc[], summaries: (string | null)[]): Promise<number> {
  let saved = 0;
  for (let i = 0; i < summaries.length && i < docs.length; i++) {
    const text = summaries[i];
    if (!text) continue;

    await prisma.$executeRawUnsafe(
      `UPDATE documents SET summary = $1 WHERE id = $2::uuid`,
      text.trim(),
      docs[i].id,
    );
    saved++;
    if (saved % 100 === 0) console.log(`[Batch] ${saved}건 요약 저장 완료...`);
  }
  return saved;
}

// ── 인라인 모드 ──
async function runInline(client: GoogleGenAI, docs: TargetDoc[]): Promise<number> {
  const inlinedRequests: InlinedRequest[] = docs.map((doc) => ({
    contents: [{
      parts: [{ text: buildPrompt(doc.title, doc.content, doc.source_type) }],
      role: 'user',
    }],
  }));

  console.log('[Batch] 배치 작업 생성 중 (인라인)...');
  const batchJob = await client.batches.create({
    model: SUMMARIZE_MODEL,
    src: inlinedRequests,
    config: {
      displayName: `rag-summarize-inline-${new Date().toISOString().slice(0, 16)}`,
    },
  });
  console.log(`[Batch] 작업 생성 완료: ${batchJob.name}`);

  const completedJob = await waitForJob(client, batchJob.name!);
  const responses = completedJob.dest?.inlinedResponses;
  if (!responses?.length) {
    console.error('[Batch] 인라인 응답이 없습니다.');
    return 0;
  }

  console.log(`[Batch] ${responses.length}건 응답 수신. DB 저장 중...`);
  const summaries = responses.map((r) =>
    r.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? null
  );
  return saveSummaries(docs, summaries);
}

// ── 파일 모드 ──
async function runFile(client: GoogleGenAI, docs: TargetDoc[]): Promise<number> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'rag-batch-sum-'));

  try {
    // JSONL 생성
    const jsonlPath = join(tmpDir, 'summarize_requests.jsonl');
    const lines = docs.map((doc) => {
      const prompt = buildPrompt(
        sanitizeText(doc.title),
        doc.content,  // buildPrompt 안에서 sanitize됨
        doc.source_type,
      );
      const line = JSON.stringify({
        custom_id: doc.id,
        url: '/v1/chat/completions',
        body: {
          model: SUMMARIZE_MODEL,
          messages: [
            { role: 'system', content: '당신은 기술 문서를 요약하는 전문가입니다. 핵심 내용만 정확하고 간결하게 요약하세요.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 1024,
        },
      });
      // JSON 직렬화 후에도 남아있을 수 있는 서로게이트 제거
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

    // 배치 작업 생성
    const batchJob = await client.batches.create({
      model: SUMMARIZE_MODEL,
      src: uploadedFile.name!,
      config: {
        displayName: `rag-summarize-file-${new Date().toISOString().slice(0, 16)}`,
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

    // custom_id = doc.id 기반으로 매핑
    const docIdToIndex = new Map(docs.map((d, i) => [d.id, i]));
    const summaries: (string | null)[] = new Array(docs.length).fill(null);
    for (const line of resultLines) {
      const result = JSON.parse(line);
      const idx = docIdToIndex.get(result.custom_id);
      if (idx !== undefined) {
        summaries[idx] = result.response?.body?.choices?.[0]?.message?.content ?? null;
      }
    }

    return saveSummaries(docs, summaries);
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
  console.log('=== Gemini Batch Summarization ===');
  console.log(`모델: ${SUMMARIZE_MODEL} | 모드: ${args.mode}`);
  if (args.sourceType) console.log(`소스 타입: ${args.sourceType}`);
  if (args.limit) console.log(`최대: ${args.limit}건`);
  console.log('');

  const docs = await getTargetDocs(args);
  console.log(`[Batch] 대상 문서: ${docs.length}건`);

  if (docs.length === 0 || args.dryRun) {
    if (args.dryRun) {
      console.log('[Batch] --dry-run 모드.');
      const byType: Record<string, number> = {};
      docs.forEach((d) => { byType[d.source_type] = (byType[d.source_type] || 0) + 1; });
      console.table(byType);
    } else {
      console.log('[Batch] 처리할 문서가 없습니다.');
    }
    await prisma.$disconnect();
    return;
  }

  const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const saved = args.mode === 'file'
    ? await runFile(client, docs)
    : await runInline(client, docs);

  console.log('');
  console.log('=== 완료 ===');
  console.log(`총 ${saved}건 요약 저장 (Batch API 50% 할인 적용)`);
  if (saved > 0) {
    console.log('');
    console.log('요약 기반으로 임베딩을 재처리하려면:');
    console.log('  pnpm batch:embed -- --reembed');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
