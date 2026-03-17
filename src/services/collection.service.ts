import { prisma } from '@/lib/prisma';
import { getCollector } from '@/collectors/registry';
import { indexItem } from '@/lib/rag/indexer';
import type { Prisma } from '@prisma/client';

export async function runCollection(sourceId: string): Promise<string> {
  const source = await prisma.collectorSource.findUnique({
    where: { id: sourceId },
  });

  if (!source) throw new Error(`Source not found: ${sourceId}`);
  if (!source.enabled) throw new Error(`Source is disabled: ${source.name}`);

  const collector = getCollector(source.type);

  // 수집 실행 기록 생성
  const run = await prisma.collectionRun.create({
    data: { sourceId },
  });

  let itemsNew = 0;
  let itemsUpdated = 0;
  let itemsSkipped = 0;
  const errors: string[] = [];

  try {
    const result = await collector.collect(source);
    errors.push(...result.errors);

    // 인덱싱
    for (const item of result.items) {
      try {
        const status = await indexItem({
          sourceId: source.id,
          sourceType: source.type,
          externalId: item.externalId,
          url: item.url,
          title: item.title,
          content: item.content,
          summary: item.summary,
          metadata: item.metadata as Prisma.InputJsonValue,
          tags: item.tags,
          publishedAt: item.publishedAt,
          projectId: source.projectId ?? undefined,
        });

        if (status === 'new') itemsNew++;
        else if (status === 'updated') itemsUpdated++;
        else itemsSkipped++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Index failed for ${item.title}: ${msg}`);
      }
    }

    const status = errors.length > 0
      ? (result.items.length > 0 ? 'PARTIAL' : 'FAILED')
      : 'SUCCESS';

    await prisma.collectionRun.update({
      where: { id: run.id },
      data: {
        status: status as 'SUCCESS' | 'PARTIAL' | 'FAILED',
        itemsFound: result.items.length,
        itemsNew,
        itemsUpdated,
        itemsSkipped,
        errorMessage: errors.length > 0 ? errors.join('\n') : null,
        completedAt: new Date(),
      },
    });

    await prisma.collectorSource.update({
      where: { id: sourceId },
      data: {
        lastRunAt: new Date(),
        lastStatus: status as 'SUCCESS' | 'PARTIAL' | 'FAILED',
      },
    });

    console.log(
      `[Collection] ${source.name}: ${itemsNew} new, ${itemsUpdated} updated, ${itemsSkipped} skipped, ${errors.length} errors`
    );

    return run.id;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    await prisma.collectionRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        errorMessage: msg,
        completedAt: new Date(),
      },
    });

    await prisma.collectorSource.update({
      where: { id: sourceId },
      data: {
        lastRunAt: new Date(),
        lastStatus: 'FAILED',
      },
    });

    throw error;
  }
}
