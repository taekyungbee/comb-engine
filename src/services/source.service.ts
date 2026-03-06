import { prisma } from '@/lib/prisma';
import { scheduleSource, unscheduleSource } from '@/lib/scheduler';
import type { SourceType, Prisma } from '@prisma/client';

interface CreateSourceInput {
  name: string;
  type: SourceType;
  url?: string;
  config?: Prisma.InputJsonValue;
  cronExpr?: string;
  enabled?: boolean;
  tags?: string[];
}

interface UpdateSourceInput {
  name?: string;
  url?: string;
  config?: Prisma.InputJsonValue;
  cronExpr?: string | null;
  enabled?: boolean;
  tags?: string[];
}

export async function listSources() {
  return prisma.collectorSource.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { documents: true, runs: true } },
    },
  });
}

export async function getSource(id: string) {
  return prisma.collectorSource.findUnique({
    where: { id },
    include: {
      _count: { select: { documents: true, runs: true } },
      runs: {
        orderBy: { startedAt: 'desc' },
        take: 10,
      },
    },
  });
}

export async function createSource(input: CreateSourceInput) {
  const source = await prisma.collectorSource.create({
    data: {
      name: input.name,
      type: input.type,
      url: input.url,
      config: input.config ?? {},
      cronExpr: input.cronExpr,
      enabled: input.enabled ?? true,
      tags: input.tags ?? [],
    },
  });

  if (source.enabled && source.cronExpr) {
    scheduleSource(source.id, source.cronExpr);
  }

  return source;
}

export async function updateSource(id: string, input: UpdateSourceInput) {
  const source = await prisma.collectorSource.update({
    where: { id },
    data: {
      name: input.name,
      url: input.url,
      config: input.config ?? undefined,
      cronExpr: input.cronExpr,
      enabled: input.enabled,
      tags: input.tags,
    },
  });

  // 스케줄 갱신
  if (source.enabled && source.cronExpr) {
    scheduleSource(source.id, source.cronExpr);
  } else {
    unscheduleSource(source.id);
  }

  return source;
}

export async function deleteSource(id: string) {
  unscheduleSource(id);
  return prisma.collectorSource.delete({ where: { id } });
}
