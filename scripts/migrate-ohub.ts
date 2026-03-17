#!/usr/bin/env npx tsx
/**
 * outsource-hub DB(portfolio_rag)에서 문서를 읽어 rag-collector DB로 마이그레이션
 *
 * 사용법:
 *   pnpm migrate:ohub                    # 전체 마이그레이션
 *   pnpm migrate:ohub -- --dry-run       # 건수만 확인
 *   pnpm migrate:ohub -- --side AS_IS    # AS-IS만
 *   pnpm migrate:ohub -- --side TO_BE    # TO-BE만
 *
 * outsource-hub: 웹 UI + Knowledge 관리 + MCP
 * rag-collector: 수집 + 임베딩 + 검색 (단일 진실 소스)
 */

import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

// rag-collector DB
const ragPrisma = new PrismaClient();

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const sideFilter = args.find(a => a.startsWith('--side='))?.split('=')[1];

const SOURCE_TYPE = 'API_INGEST' as const;
const RAG_PROJECT_ID = 'cmmjafnkf0000mv6h4phyq11t';

interface OhubSource {
  id: string;
  name: string;
  type: string;
  side: string;
  environment: string;
  config: unknown;
  enabled: boolean;
}

interface OhubDocument {
  id: string;
  title: string;
  content: string;
  content_hash: string;
  metadata: unknown;
  created_at: string;
}

/** JSON 쿼리로 ohub sources 가져오기 */
async function getOhubSources(): Promise<OhubSource[]> {
  const { execSync } = await import('child_process');

  let whereClause = '';
  if (sideFilter) whereClause = `WHERE ds.side = '${sideFilter}'`;

  const sql = `SELECT json_agg(row_to_json(t)) FROM (SELECT id, name, type, side, environment, config, enabled FROM data_sources ds ${whereClause} ORDER BY side, name) t`;
  const cmd = `ssh lazybee@192.168.0.67 "docker exec rag-pgvector psql -U rag -d portfolio_rag -t -A -c \\"${sql}\\""`;

  const result = execSync(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }).toString().trim();
  if (!result || result === '') return [];
  return JSON.parse(result) as OhubSource[];
}

/** 특정 소스의 문서 가져오기 (JSON) */
async function getOhubDocuments(sourceId: string): Promise<OhubDocument[]> {
  const { execSync } = await import('child_process');

  const sql = `SELECT json_agg(row_to_json(t)) FROM (SELECT id, title, content, content_hash, metadata, created_at FROM documents WHERE source_id = '${sourceId}' ORDER BY created_at ASC) t`;
  const cmd = `ssh lazybee@192.168.0.67 "docker exec rag-pgvector psql -U rag -d portfolio_rag -t -A -c \\"${sql}\\""`;

  const result = execSync(cmd, { maxBuffer: 200 * 1024 * 1024, timeout: 120000 }).toString().trim();
  if (!result || result === '' || result === 'null') return [];
  return JSON.parse(result) as OhubDocument[];
}

async function getOrCreateRagSource(ohubSource: OhubSource): Promise<string> {
  const sourceName = `OHUB: ${ohubSource.name}`;

  const existing = await ragPrisma.collectorSource.findFirst({
    where: { name: sourceName, projectId: RAG_PROJECT_ID },
  });
  if (existing) return existing.id;

  const created = await ragPrisma.collectorSource.create({
    data: {
      name: sourceName,
      type: SOURCE_TYPE,
      config: JSON.parse(JSON.stringify({
        ohubSourceId: ohubSource.id,
        ohubType: ohubSource.type,
        side: ohubSource.side,
        environment: ohubSource.environment,
        originalConfig: ohubSource.config,
      })),
      enabled: false,
      tags: ['komca', ohubSource.side === 'AS_IS' ? 'as-is' : 'to-be', ohubSource.type.toLowerCase()],
      projectId: RAG_PROJECT_ID,
    },
  });

  console.log(`  소스 생성: ${sourceName} → ${created.id}`);
  return created.id;
}

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

async function migrateSource(ohubSource: OhubSource) {
  console.log(`\n[${ohubSource.name}] (${ohubSource.type}/${ohubSource.side})`);

  const docs = await getOhubDocuments(ohubSource.id);
  console.log(`  outsource-hub 문서: ${docs.length}건`);

  if (docs.length === 0) return { created: 0, skipped: 0, chunked: 0 };
  if (isDryRun) return { created: docs.length, skipped: 0, chunked: 0 };

  const ragSourceId = await getOrCreateRagSource(ohubSource);

  let created = 0;
  let skipped = 0;
  let chunked = 0;

  for (const doc of docs) {
    if (!doc.content || doc.content.trim().length < 10) {
      skipped++;
      continue;
    }

    const contentHash = createHash('sha256').update(doc.content).digest('hex');
    const externalId = `ohub:${doc.id}`;

    const existing = await ragPrisma.document.findUnique({
      where: { sourceId_externalId: { sourceId: ragSourceId, externalId } },
    });

    if (existing && existing.contentHash === contentHash) {
      skipped++;
      continue;
    }

    const metadata = {
      ...(typeof doc.metadata === 'object' && doc.metadata !== null ? doc.metadata as Record<string, unknown> : {}),
      ohubSourceType: ohubSource.type,
      ohubSide: ohubSource.side,
      ohubEnvironment: ohubSource.environment,
      ohubDocId: doc.id,
    };

    const tags = [
      'komca',
      ohubSource.side === 'AS_IS' ? 'as-is' : 'to-be',
      ohubSource.type.toLowerCase(),
      'ohub-migrated',
    ];

    const chunks = chunkText(doc.content);

    if (existing) {
      await ragPrisma.documentChunk.deleteMany({ where: { documentId: existing.id } });
      await ragPrisma.document.update({
        where: { id: existing.id },
        data: { title: doc.title, content: doc.content, contentHash, metadata, tags },
      });

      for (const c of chunks) {
        await ragPrisma.documentChunk.create({
          data: { documentId: existing.id, content: c.text, chunkIndex: c.index, tokenCount: Math.ceil(c.text.length / 4) },
        });
      }
      created++;
      chunked += chunks.length;
    } else {
      const newDoc = await ragPrisma.document.create({
        data: {
          sourceId: ragSourceId,
          sourceType: SOURCE_TYPE,
          externalId,
          title: doc.title,
          content: doc.content,
          contentHash,
          metadata,
          tags,
          projectId: RAG_PROJECT_ID,
          publishedAt: new Date(doc.created_at),
        },
      });

      for (const c of chunks) {
        await ragPrisma.documentChunk.create({
          data: { documentId: newDoc.id, content: c.text, chunkIndex: c.index, tokenCount: Math.ceil(c.text.length / 4) },
        });
      }
      created++;
      chunked += chunks.length;
    }

    if ((created + skipped) % 500 === 0) {
      process.stdout.write(`\r  진행: ${created + skipped}/${docs.length} (생성: ${created}, 스킵: ${skipped})`);
    }
  }

  console.log(`  완료: 생성 ${created}, 스킵 ${skipped}, 청크 ${chunked}건`);
  return { created, skipped, chunked };
}

async function main() {
  console.log('=== outsource-hub → rag-collector 마이그레이션 ===');
  console.log(`모드: ${isDryRun ? 'DRY RUN' : '실제 실행'}`);
  if (sideFilter) console.log(`필터: ${sideFilter}`);

  const sources = await getOhubSources();
  console.log(`대상 소스: ${sources.length}개`);

  let totalCreated = 0;
  let totalSkipped = 0;
  let totalChunked = 0;

  for (const source of sources) {
    const result = await migrateSource(source);
    totalCreated += result.created;
    totalSkipped += result.skipped;
    totalChunked += result.chunked;
  }

  console.log('\n=== 결과 ===');
  console.log(`생성: ${totalCreated}건`);
  console.log(`스킵: ${totalSkipped}건`);
  console.log(`청크: ${totalChunked}건`);

  if (!isDryRun && totalCreated > 0) {
    console.log('\n다음 단계: 임베딩 생성');
    console.log('  pnpm batch:embed -- --source-type API_INGEST');
  }
}

main()
  .catch(console.error)
  .finally(() => ragPrisma.$disconnect());
