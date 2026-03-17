#!/usr/bin/env npx tsx
/**
 * CSV 파일을 rag-collector에 수집
 *
 * 사용법:
 *   pnpm ingest:csv -- --file /path/to.csv --name "소스명" --type DOCUMENT [--side AS_IS|TO_BE]
 */

import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

const prisma = new PrismaClient();
const RAG_PROJECT_ID = 'cmmjafnkf0000mv6h4phyq11t';

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const filePath = getArg('file');
const sourceName = getArg('name');
const sourceType = (getArg('type') || 'DOCUMENT') as 'DOCUMENT';
const side = getArg('side') || 'TO_BE';
const isDryRun = args.includes('--dry-run');

if (!filePath || !sourceName) {
  console.error('사용법: --file /path/to.csv --name "소스명" [--type DOCUMENT] [--side AS_IS|TO_BE]');
  process.exit(1);
}

function parseCSV(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  // 간단한 CSV 파서 (쉼표 구분, 따옴표 처리)
  function parseLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

/** 행 그룹을 텍스트 문서로 변환 */
function rowsToDocument(headers: string[], rows: string[][], groupKey: string, groupValue: string): string {
  const lines: string[] = [`## ${groupKey}: ${groupValue}`, ''];

  for (const row of rows) {
    const parts: string[] = [];
    for (let i = 0; i < headers.length; i++) {
      if (row[i] && row[i].trim()) {
        parts.push(`${headers[i]}: ${row[i]}`);
      }
    }
    lines.push(parts.join(' | '));
  }

  return lines.join('\n');
}

async function main() {
  console.log(`=== CSV 수집: ${sourceName} ===`);
  console.log(`파일: ${filePath}`);

  const content = readFileSync(filePath!, 'utf-8');
  const { headers, rows } = parseCSV(content);
  console.log(`헤더: ${headers.join(', ')}`);
  console.log(`행 수: ${rows.length}`);

  if (isDryRun) {
    console.log('DRY RUN - 종료');
    await prisma.$disconnect();
    return;
  }

  // 소스 생성/조회
  let source = await prisma.collectorSource.findFirst({
    where: { name: sourceName!, projectId: RAG_PROJECT_ID },
  });

  if (!source) {
    source = await prisma.collectorSource.create({
      data: {
        name: sourceName!,
        type: sourceType,
        config: { filePath, side },
        enabled: false,
        tags: ['komca', side === 'AS_IS' ? 'as-is' : 'to-be', 'document', 'csv'],
        projectId: RAG_PROJECT_ID,
      },
    });
    console.log(`소스 생성: ${source.id}`);
  }

  // 테이블명 기준으로 그룹핑 (컬럼 표준화) 또는 전체를 하나의 문서로 (단어 사전)
  const isColumnMapping = headers.some(h => h.includes('테이블명'));

  let created = 0;
  let chunked = 0;

  if (isColumnMapping) {
    // 테이블명(AS-IS) 기준 그룹핑
    const tableIdx = headers.findIndex(h => h.includes('테이블명(AS-IS)'));
    const groups = new Map<string, string[][]>();

    for (const row of rows) {
      const key = row[tableIdx] || 'UNKNOWN';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    console.log(`테이블 그룹: ${groups.size}개`);

    for (const [tableName, tableRows] of groups) {
      const docContent = rowsToDocument(headers, tableRows, '테이블', tableName);
      if (docContent.trim().length < 10) continue;

      const hash = createHash('sha256').update(docContent).digest('hex');
      const externalId = `csv:column-mapping:${tableName}`;

      const existing = await prisma.document.findUnique({
        where: { sourceId_externalId: { sourceId: source.id, externalId } },
      });

      if (existing) continue;

      const doc = await prisma.document.create({
        data: {
          sourceId: source.id,
          sourceType: sourceType,
          externalId,
          title: `컬럼 매핑: ${tableName}`,
          content: docContent,
          contentHash: hash,
          metadata: { tableName, rowCount: tableRows.length, type: 'column_mapping' },
          tags: ['komca', 'to-be', 'column-mapping', 'csv'],
          projectId: RAG_PROJECT_ID,
        },
      });

      // 청크 생성
      const chunks = chunkByLines(docContent, 1500);
      for (const chunk of chunks) {
        await prisma.documentChunk.create({
          data: { documentId: doc.id, content: chunk.text, chunkIndex: chunk.index, tokenCount: Math.ceil(chunk.text.length / 4) },
        });
        chunked++;
      }
      created++;
    }
  } else {
    // 단어 사전: 50행씩 그룹
    const BATCH = 50;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const docContent = rowsToDocument(headers, batch, '표준단어사전', `${i + 1}-${i + batch.length}`);
      if (docContent.trim().length < 10) continue;

      const hash = createHash('sha256').update(docContent).digest('hex');
      const externalId = `csv:dictionary:${i}`;

      const existing = await prisma.document.findUnique({
        where: { sourceId_externalId: { sourceId: source.id, externalId } },
      });

      if (existing) continue;

      const doc = await prisma.document.create({
        data: {
          sourceId: source.id,
          sourceType: sourceType,
          externalId,
          title: `표준단어사전 ${i + 1}-${i + batch.length}`,
          content: docContent,
          contentHash: hash,
          metadata: { startRow: i + 1, endRow: i + batch.length, type: 'dictionary' },
          tags: ['komca', 'to-be', 'dictionary', 'csv'],
          projectId: RAG_PROJECT_ID,
        },
      });

      const chunks = chunkByLines(docContent, 1500);
      for (const chunk of chunks) {
        await prisma.documentChunk.create({
          data: { documentId: doc.id, content: chunk.text, chunkIndex: chunk.index, tokenCount: Math.ceil(chunk.text.length / 4) },
        });
        chunked++;
      }
      created++;
    }
  }

  console.log(`\n=== 완료 ===`);
  console.log(`문서: ${created}건, 청크: ${chunked}건`);

  await prisma.$disconnect();
}

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

main().catch(console.error);
