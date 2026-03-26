#!/usr/bin/env npx tsx
/**
 * 기존 문서를 smartChunk로 재인덱싱하는 스크립트
 * 1. 기존 청크 전부 삭제
 * 2. 각 문서를 smartChunk로 재청킹
 * 3. 임베딩 재생성
 *
 * Usage: npx tsx scripts/reindex-smart.ts [--dry-run] [--project-id xxx]
 */

import { PrismaClient } from '@prisma/client';
import { smartChunk, type SourceType as RagSourceType } from '@side/rag-core';

const prisma = new PrismaClient();

const SOURCE_TYPE_MAP: Record<string, RagSourceType> = {
  WEB_CRAWL: 'WEB_CRAWL',
  YOUTUBE_CHANNEL: 'YOUTUBE',
  RSS_FEED: 'RSS_FEED',
  GITHUB_REPO: 'GITHUB_REPO',
  DOCUMENT_FILE: 'DOCUMENT',
  GOOGLE_WORKSPACE: 'DOCUMENT',
  NOTION_PAGE: 'DOCUMENT',
  MOLTBOOK: 'DOCUMENT',
  GMAIL: 'DOCUMENT',
  GOOGLE_CALENDAR: 'GENERIC',
  GOOGLE_CHAT: 'GENERIC',
  GIT_CLONE: 'GITHUB_REPO',
  API_INGEST: 'API_INGEST',
  ORACLE_SCHEMA: 'ORACLE_SCHEMA',
  JAVA_SOURCE: 'JAVA_SOURCE',
  XML_UI: 'XML_UI',
  FRONTEND_SOURCE: 'FRONTEND_SOURCE',
  DOCUMENT: 'DOCUMENT',
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const projectIdArg = process.argv.indexOf('--project-id');
  const projectId = projectIdArg >= 0 ? process.argv[projectIdArg + 1] : undefined;

  console.log(`=== smartChunk 재인덱싱 ${dryRun ? '(DRY RUN)' : ''} ===`);
  if (projectId) console.log(`프로젝트 필터: ${projectId}`);

  const where = projectId ? { projectId } : {};
  const documents = await prisma.document.findMany({
    where,
    select: { id: true, title: true, content: true, sourceType: true },
    orderBy: { collectedAt: 'asc' },
  });

  console.log(`총 ${documents.length}개 문서`);

  let totalOldChunks = 0;
  let totalNewChunks = 0;

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const ragSourceType = SOURCE_TYPE_MAP[doc.sourceType] ?? 'GENERIC';

    // 기존 청크 수
    const oldCount = await prisma.documentChunk.count({
      where: { documentId: doc.id },
    });

    // smartChunk 적용
    const newChunks = smartChunk(doc.content, { sourceType: ragSourceType });

    totalOldChunks += oldCount;
    totalNewChunks += newChunks.length;

    if (i < 10 || oldCount !== newChunks.length) {
      console.log(
        `[${i + 1}/${documents.length}] ${doc.title.substring(0, 50)}... ` +
          `(${doc.sourceType}→${ragSourceType}): ${oldCount}→${newChunks.length} 청크`
      );
    }

    if (!dryRun) {
      // 기존 청크 삭제
      await prisma.documentChunk.deleteMany({
        where: { documentId: doc.id },
      });

      // 새 청크 생성 (임베딩 없이 - 배치로 후처리)
      await Promise.all(
        newChunks.map((chunk) =>
          prisma.documentChunk.create({
            data: {
              documentId: doc.id,
              content: chunk.text,
              chunkIndex: chunk.index,
            },
          })
        )
      );
    }
  }

  console.log(`\n=== 결과 ===`);
  console.log(`총 문서: ${documents.length}`);
  console.log(`기존 청크: ${totalOldChunks}`);
  console.log(`새 청크: ${totalNewChunks}`);
  console.log(`변화: ${totalNewChunks - totalOldChunks} (${totalNewChunks > totalOldChunks ? '+' : ''}${((totalNewChunks / totalOldChunks - 1) * 100).toFixed(1)}%)`);

  if (dryRun) {
    console.log('\n(DRY RUN - 실제 변경 없음)');
  } else {
    console.log('\n재인덱싱 완료. 임베딩 재생성은 pnpm batch:embed 실행 필요.');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
