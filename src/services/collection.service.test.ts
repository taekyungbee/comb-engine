import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  collectorSource: { findUnique: vi.fn(), update: vi.fn() },
  collectionRun: { create: vi.fn(), update: vi.fn() },
  document: { findMany: vi.fn() },
  collect: vi.fn(), indexItem: vi.fn(), deleteDocuments: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('@/collectors/registry', () => ({ getCollector: () => ({ collect: mocks.collect }) }));
vi.mock('@/lib/rag/indexer', () => ({ indexItem: mocks.indexItem, deleteDocuments: mocks.deleteDocuments }));
import { runCollection } from './collection.service';

const cursor = { startedAt: '2026-10-18T00:00:00Z', cutoff: null, afterVaultId: 'v1', afterDocId: 'n1' };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.collectorSource.findUnique.mockResolvedValue({ id: 's1', enabled: true, type: 'BAALDA', config: { maxNotes: 1 } });
  mocks.collectionRun.create.mockResolvedValue({ id: 'r1' });
  mocks.indexItem.mockResolvedValue('new');
  mocks.document.findMany.mockResolvedValue([{ id: 'empty-doc' }]);
  mocks.deleteDocuments.mockResolvedValue({ documents: 1 });
});

describe('collection continuation persistence', () => {
  const item = { externalId: 'n1', title: 'note', content: 'note body content' };
  it('persists the cursor only after successfully indexing a bounded page', async () => {
    mocks.collect.mockResolvedValue({ items: [item], errors: [], continuation: cursor, syncStartedAt: cursor.startedAt });
    await runCollection('s1');
    expect(mocks.collectorSource.update).toHaveBeenCalledWith({
      where: { id: 's1' }, data: {
        lastStatus: 'PARTIAL', lastRunAt: new Date(cursor.startedAt), config: { maxNotes: 1, _baaldaContinuation: cursor },
      },
    });
    expect(mocks.indexItem.mock.invocationCallOrder[0]).toBeLessThan(mocks.collectorSource.update.mock.invocationCallOrder[0]);
  });

  it('retains the prior cursor if indexing fails', async () => {
    mocks.collect.mockResolvedValue({ items: [item], errors: [], continuation: cursor });
    mocks.indexItem.mockRejectedValue(new Error('index failure'));
    await runCollection('s1');
    expect(mocks.collectorSource.update.mock.calls[0][0].data).not.toHaveProperty('config');
    expect(mocks.collectionRun.update.mock.calls[0][0].data.status).toBe('PARTIAL');
  });

  it('deletes empty notes during incremental collection and clears the cursor on completion', async () => {
    mocks.collect.mockResolvedValue({ items: [], errors: [], deletedExternalIds: ['n1'], continuation: null, syncStartedAt: cursor.startedAt });
    await runCollection('s1');
    expect(mocks.document.findMany).toHaveBeenCalledWith({ where: { sourceId: 's1', externalId: { in: ['n1'] } }, select: { id: true } });
    expect(mocks.deleteDocuments).toHaveBeenCalledWith(['empty-doc']);
    expect(mocks.collectorSource.update.mock.calls[0][0].data).toMatchObject({ lastStatus: 'SUCCESS', config: { _baaldaContinuation: null } });
  });

  it('does not advance the cursor when tombstone deletion fails', async () => {
    mocks.collect.mockResolvedValue({ items: [], errors: [], deletedExternalIds: ['n1'], continuation: cursor });
    mocks.deleteDocuments.mockRejectedValue(new Error('delete failure'));
    await runCollection('s1');
    expect(mocks.collectorSource.update.mock.calls[0][0].data).not.toHaveProperty('config');
  });
});
