#!/usr/bin/env npx tsx
/**
 * 청크가 없는 문서에 대해 소스 타입별 스마트 청킹 수행
 *
 * 사용법:
 *   pnpm chunk:missing                                # 전체
 *   pnpm chunk:missing -- --source-type JAVA_SOURCE   # 특정 소스만
 *   pnpm chunk:missing -- --dry-run                   # 건수만 확인
 *   pnpm chunk:missing -- --limit 1000                # 최대 1000건
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const sourceTypeArg = args.find((_, i, a) => a[i - 1] === '--source-type');
const limitArg = args.find((_, i, a) => a[i - 1] === '--limit');
const limit = limitArg ? parseInt(limitArg, 10) : 0;

/** 500자, 50자 오버랩 기본 청킹 */
function chunkText(text: string, chunkSize = 500, overlap = 50): { text: string; index: number }[] {
  const chunks: { text: string; index: number }[] = [];
  let start = 0;
  let idx = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end);
    if (chunk.trim().length >= 10) {
      chunks.push({ text: chunk, index: idx++ });
    }
    start += chunkSize - overlap;
  }
  return chunks;
}

/** 줄 단위 스마트 청킹 */
function chunkByLines(text: string, maxChunkSize = 1500, overlapLines = 3): { text: string; index: number }[] {
  const lines = text.split('\n');
  const chunks: { text: string; index: number }[] = [];
  let currentLines: string[] = [];
  let currentSize = 0;
  let idx = 0;

  for (const line of lines) {
    if (currentSize + line.length + 1 > maxChunkSize && currentLines.length > 0) {
      const chunk = currentLines.join('\n');
      if (chunk.trim().length >= 10) chunks.push({ text: chunk, index: idx++ });
      currentLines = currentLines.slice(-overlapLines);
      currentSize = currentLines.reduce((s, l) => s + l.length + 1, 0);
    }
    currentLines.push(line);
    currentSize += line.length + 1;
  }

  if (currentLines.length > 0) {
    const last = currentLines.join('\n');
    if (last.trim().length >= 10) chunks.push({ text: last, index: idx++ });
  }
  return chunks;
}

/** Java 전처리: import 제거, 메서드 단위 분리 */
function preprocessJava(content: string, title: string): { text: string; index: number }[] {
  const lines = content.split('\n');
  const codeLines = lines.filter(l => !l.trim().startsWith('import ') && !l.trim().startsWith('package '));
  const cleaned = codeLines.join('\n');

  const methodPattern = /^[ \t]*(public|private|protected)[\s\S]*?\n[ \t]*\}/gm;
  const methods = cleaned.match(methodPattern);

  if (methods && methods.length > 1) {
    const prefix = `[Java] ${title}\n`;
    return methods.map((method, idx) => ({ text: (prefix + method.trim()).slice(0, 2000), index: idx }));
  }
  return chunkByLines(`[Java] ${title}\n${cleaned}`, 1500);
}

/** Frontend 전처리: import/타입 제거, 함수 단위 분리 */
function preprocessFrontend(content: string, title: string): { text: string; index: number }[] {
  const lines = content.split('\n');
  const codeLines = lines.filter(l => {
    const t = l.trim();
    return !t.startsWith('import ') && !t.startsWith('export type ') && !t.startsWith('export interface ');
  });
  const cleaned = codeLines.join('\n');
  return chunkByLines(`[Frontend] ${title}\n${cleaned}`, 1500);
}

/** Oracle DDL 전처리 */
function preprocessOracle(content: string, title: string): { text: string; index: number }[] {
  const enriched = `[Oracle 테이블] ${title}\n${content}`;
  if (enriched.length <= 2000) return [{ text: enriched, index: 0 }];
  return chunkByLines(enriched, 1500);
}

/** 소스 타입별 스마트 청킹 */
function smartChunk(content: string, title: string, sourceType: string): { text: string; index: number }[] {
  switch (sourceType) {
    case 'JAVA_SOURCE':
      return preprocessJava(content, title);
    case 'FRONTEND_SOURCE':
      return preprocessFrontend(content, title);
    case 'ORACLE_SCHEMA':
      return preprocessOracle(content, title);
    case 'XML_UI':
      if (content.length <= 2000) return [{ text: content, index: 0 }];
      return chunkByLines(content, 1500);
    default:
      return chunkByLines(`${title}\n${content}`, 1500);
  }
}

async function main() {
  console.log('=== 청크 없는 문서 스마트 청킹 ===');
  console.log(`모드: ${isDryRun ? 'DRY RUN' : '실제 실행'}`);
  if (sourceTypeArg) console.log(`소스 타입: ${sourceTypeArg}`);

  const sourceFilter = sourceTypeArg ? `AND d.source_type = '${sourceTypeArg}'` : '';
  const limitClause = limit > 0 ? `LIMIT ${limit}` : '';

  const docs: { id: string; title: string; content: string; source_type: string }[] = await prisma.$queryRawUnsafe(`
    SELECT d.id, d.title, d.content, d.source_type
    FROM documents d
    WHERE NOT EXISTS (SELECT 1 FROM document_chunks dc WHERE dc.document_id = d.id)
      AND LENGTH(TRIM(d.content)) >= 10
      ${sourceFilter}
    ORDER BY d.collected_at ASC
    ${limitClause}
  `);

  console.log(`대상 문서: ${docs.length}건`);

  if (isDryRun) {
    // 소스타입별 통계만 출력
    const stats = new Map<string, number>();
    for (const d of docs) stats.set(d.source_type, (stats.get(d.source_type) || 0) + 1);
    for (const [type, count] of stats) console.log(`  ${type}: ${count}건`);
    await prisma.$disconnect();
    return;
  }

  let totalChunks = 0;
  let processed = 0;

  for (const doc of docs) {
    const chunks = smartChunk(doc.content, doc.title, doc.source_type);

    if (chunks.length > 0) {
      // 배치로 청크 INSERT
      const values = chunks.map(c =>
        `(gen_random_uuid(), '${doc.id}', $${totalChunks + c.index + 1}, ${c.index}, ${Math.ceil(c.text.length / 4)}, now())`
      );

      // 개별 INSERT (안전)
      for (const chunk of chunks) {
        await prisma.documentChunk.create({
          data: {
            documentId: doc.id,
            content: chunk.text,
            chunkIndex: chunk.index,
            tokenCount: Math.ceil(chunk.text.length / 4),
          },
        });
      }
      totalChunks += chunks.length;
    }

    processed++;
    if (processed % 500 === 0) {
      process.stdout.write(`\r  진행: ${processed}/${docs.length} (청크: ${totalChunks}건)`);
    }
  }

  console.log(`\n=== 완료 ===`);
  console.log(`문서: ${processed}건 처리, 청크: ${totalChunks}건 생성`);
  console.log('\n다음 단계:');
  console.log('  pnpm batch:summarize   # AI 요약 생성');
  console.log('  pnpm batch:embed       # 임베딩 생성');

  await prisma.$disconnect();
}

main().catch(console.error);
