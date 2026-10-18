import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), scroll: vi.fn(), getCollection: vi.fn() }));
vi.mock('@prisma/client', () => ({ PrismaClient: class { documentChunk = { findMany: mocks.findMany }; } }));
vi.mock('@qdrant/js-client-rest', () => ({ QdrantClient: class { scroll = mocks.scroll; getCollection = mocks.getCollection; } }));
vi.mock('@/lib/rag/indexer', () => ({ buildChunkPayload: vi.fn() }));
vi.mock('@/lib/qdrant', () => ({ textToSparse: vi.fn() }));
import { verify } from '../../../scripts/reindex-full';

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });
describe('reindex project verification', () => {
  it.each(['p1', '', undefined])('scopes both PG and Qdrant counts to project %s', async (project) => {
    mocks.findMany.mockResolvedValue([{ id: 'c1', document: { projectId: project || null } }]);
    mocks.scroll.mockResolvedValue({ points: [{ id: 'c1' }], next_page_offset: null });
    mocks.getCollection.mockResolvedValue({ points_count: 42 });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await verify({ target: 'test', create: false, verify: true, resume: true, project });
    expect(mocks.findMany.mock.calls[0][0].where).toEqual(project === undefined ? {} : { document: { projectId: project || null } });
    const expectedFilter = project === undefined ? undefined : { must: project === '' ? [{ is_empty: { key: 'project_id' } }] : [{ key: 'project_id', match: { value: project } }] };
    expect(mocks.scroll.mock.calls[0][1].filter).toEqual(expectedFilter);
    const report = JSON.parse(String(log.mock.calls[0][0]).slice('VERIFY '.length));
    expect(report).toMatchObject({ points: 1, collectionPoints: 42, pgChunks: 1, matchRate: 100, pointsWithoutChunk: 0 });
  });
});
