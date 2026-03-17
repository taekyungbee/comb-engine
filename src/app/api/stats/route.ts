import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getIndexStats } from '@/services/search.service';

export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get('projectId') ?? undefined;
    const projectFilter = projectId ? { projectId } : {};

    const [indexStats, sourceCount, recentRuns] = await Promise.all([
      getIndexStats(projectId),
      prisma.collectorSource.count({ where: projectFilter }),
      prisma.collectionRun.findMany({
        where: projectId ? { source: { projectId } } : undefined,
        orderBy: { startedAt: 'desc' },
        take: 10,
        include: { source: { select: { name: true, type: true } } },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        sources: sourceCount,
        documents: indexStats.documentCount,
        chunks: indexStats.chunkCount,
        sourceBreakdown: indexStats.sourceBreakdown,
        recentRuns,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: { message, code: 'STATS_FAILED' } }, { status: 500 });
  }
}
