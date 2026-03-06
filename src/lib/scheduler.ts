import cron, { type ScheduledTask } from 'node-cron';
import { prisma } from './prisma';
import { runCollection } from '@/services/collection.service';

const activeTasks = new Map<string, ScheduledTask>();

export async function initScheduler(): Promise<void> {
  const sources = await prisma.collectorSource.findMany({
    where: { enabled: true, cronExpr: { not: null } },
  });

  for (const source of sources) {
    if (source.cronExpr) {
      scheduleSource(source.id, source.cronExpr);
    }
  }

  console.log(`[Scheduler] ${sources.length}개 소스 스케줄 초기화 완료`);
}

export function scheduleSource(sourceId: string, cronExpr: string): void {
  unscheduleSource(sourceId);

  if (!cron.validate(cronExpr)) {
    console.error(`[Scheduler] Invalid cron expression: ${cronExpr} for source ${sourceId}`);
    return;
  }

  const task = cron.schedule(cronExpr, async () => {
    console.log(`[Scheduler] Running collection for source ${sourceId}`);
    try {
      await runCollection(sourceId);
    } catch (error) {
      console.error(`[Scheduler] Collection failed for ${sourceId}:`, error);
    }
  }, { timezone: 'Asia/Seoul' });

  activeTasks.set(sourceId, task);
  console.log(`[Scheduler] Scheduled source ${sourceId} with cron: ${cronExpr}`);
}

export function unscheduleSource(sourceId: string): void {
  const existing = activeTasks.get(sourceId);
  if (existing) {
    existing.stop();
    activeTasks.delete(sourceId);
  }
}

export async function reloadScheduler(): Promise<void> {
  for (const [id] of activeTasks) {
    unscheduleSource(id);
  }
  await initScheduler();
}

export function getSchedulerStatus(): { sourceId: string; active: boolean }[] {
  return Array.from(activeTasks.entries()).map(([sourceId]) => ({
    sourceId,
    active: true,
  }));
}
