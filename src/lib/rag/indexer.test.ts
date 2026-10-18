import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  document: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  documentChunk: { findMany: vi.fn(), deleteMany: vi.fn() },
  deletePoints: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { document: mocks.document, documentChunk: mocks.documentChunk } }));
vi.mock('@/lib/qdrant', () => ({
  getQdrantClient: () => ({ delete: mocks.deletePoints }), getCollectionName: () => 'test', textToSparse: vi.fn(),
}));
vi.mock('@/lib/llm', () => ({ summarizeContent: vi.fn() }));
import { deleteDocuments, indexItem } from './indexer';

beforeEach(() => { vi.resetAllMocks(); });

describe('indexItem title adoption authorization', () => {
  const item = { sourceId: 's1', sourceType: 'API_INGEST' as const, externalId: 'new-id', title: 'same title', content: 'updated document body', adoptByTitle: true };

  it('requires caller authorization for title adoption', async () => {
    mocks.document.findUnique.mockResolvedValue(null);
    await expect(indexItem(item)).rejects.toThrow('requires document authorization');
    expect(mocks.document.findFirst).not.toHaveBeenCalled();
    expect(mocks.document.update).not.toHaveBeenCalled();
  });

  it('authorizes the selected document before any identity/content/chunk mutation', async () => {
    const candidate = { id: 'private-doc', collectionId: 'other-private', projectId: 'p1' };
    mocks.document.findUnique.mockResolvedValue(null);
    mocks.document.findFirst.mockResolvedValue(candidate);
    const authorizeDocument = vi.fn().mockRejectedValue(new Error('Forbidden'));
    await expect(indexItem(item, { authorizeDocument })).rejects.toThrow('Forbidden');
    expect(authorizeDocument).toHaveBeenCalledWith(candidate);
    expect(mocks.document.update).not.toHaveBeenCalled();
    expect(mocks.documentChunk.deleteMany).not.toHaveBeenCalled();
  });

  it('also checks an externalId match so adoption cannot bypass access via a known ID', async () => {
    mocks.document.findUnique.mockResolvedValue({ id: 'private-doc', collectionId: 'other-private' });
    await expect(indexItem(item, { authorizeDocument: vi.fn().mockRejectedValue(new Error('Forbidden')) })).rejects.toThrow('Forbidden');
    expect(mocks.document.update).not.toHaveBeenCalled();
    expect(mocks.documentChunk.deleteMany).not.toHaveBeenCalled();
  });
});

describe('deleteDocuments legacy points', () => {
  it('deletes points by chunk ID before removing the PostgreSQL mapping', async () => {
    mocks.documentChunk.findMany.mockResolvedValue([{ id: 'legacy-chunk' }]);
    mocks.deletePoints.mockResolvedValue({});
    mocks.document.deleteMany.mockResolvedValue({ count: 1 });
    await expect(deleteDocuments(['d1'])).resolves.toEqual({ documents: 1, qdrantFiltered: 1 });
    expect(mocks.deletePoints).toHaveBeenCalledWith('test', { wait: true, points: ['legacy-chunk'] });
    expect(mocks.deletePoints.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.document.deleteMany.mock.invocationCallOrder[0]);
  });

  it('retains PostgreSQL documents/chunks if legacy point deletion fails', async () => {
    mocks.documentChunk.findMany.mockResolvedValue([{ id: 'legacy-chunk' }]);
    mocks.deletePoints.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Qdrant unavailable'));
    await expect(deleteDocuments(['d1'])).rejects.toThrow('Qdrant unavailable');
    expect(mocks.document.deleteMany).not.toHaveBeenCalled();
  });
});
