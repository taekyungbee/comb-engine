import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    const [runs, total] = await Promise.all([
      prisma.collectionRun.findMany({
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { source: { select: { name: true, type: true } } },
      }),
      prisma.collectionRun.count(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        runs,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: { message, code: 'LIST_FAILED' } }, { status: 500 });
  }
}
