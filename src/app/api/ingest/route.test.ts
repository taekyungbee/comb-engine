import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => ({
  document: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  collection: { findUnique: vi.fn() },
  collectorSource: { findFirst: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('@/lib/api-auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({ userId: 'member', role: 'MEMBER' }),
  requireRole: (user: unknown) => user,
  AuthError: class extends Error { constructor(message: string, public statusCode: number) { super(message); } },
}));
vi.mock('@/middleware/rate-limit', () => ({ rateLimitMiddleware: () => (handler: unknown) => handler }));
vi.mock('@/lib/llm', () => ({ summarizeContent: vi.fn() }));
import { POST } from './route';

const content = 'a document body long enough to index';
function request(extra: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/ingest', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Same title', content, externalId: 'stable-id', adoptByTitle: true, ...extra }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collectorSource.findFirst.mockResolvedValue({ id: 'api-ingest' });
  mocks.document.findUnique.mockResolvedValue(null);
});

describe('MEMBER /api/ingest title adoption', () => {
  it('returns 403 when collectionId is omitted and the matching document is private to another user', async () => {
    mocks.document.findFirst.mockResolvedValue({ id: 'private-doc', projectId: null, collectionId: 'private' });
    mocks.collection.findUnique.mockResolvedValue({ ownerId: 'other', visibility: 'PRIVATE' });
    const response = await POST(request(), undefined);
    expect(response.status).toBe(403);
    expect(mocks.document.update).not.toHaveBeenCalled();
  });

  it('checks the adopted collection even when the caller supplies an accessible destination', async () => {
    mocks.document.findFirst.mockResolvedValue({ id: 'private-doc', projectId: null, collectionId: 'private' });
    mocks.collection.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      ({ ownerId: 'other', visibility: where.id === 'shared' ? 'SHARED' : 'PRIVATE' }));
    expect((await POST(request({ collectionId: 'shared' }), undefined)).status).toBe(403);
    expect(mocks.document.update).not.toHaveBeenCalled();
  });

  it('rejects a candidate outside the requested project before changing its identity', async () => {
    mocks.document.findFirst.mockResolvedValue({ id: 'other-project', projectId: 'other', collectionId: null });
    expect((await POST(request({ projectId: 'requested' }), undefined)).status).toBe(403);
    expect(mocks.document.update).not.toHaveBeenCalled();
  });

  it.each([
    { ownerId: 'member', visibility: 'PRIVATE' },
    { ownerId: 'other', visibility: 'SHARED' },
    { ownerId: 'other', visibility: 'PUBLIC' },
  ])('allows existing collection access policy: %j', async (collection) => {
    const candidate = {
      id: 'allowed-doc', projectId: null, collectionId: 'allowed', externalId: 'old-id',
      contentHash: createHash('sha256').update(content).digest('hex'),
    };
    mocks.document.findFirst.mockResolvedValue(candidate);
    mocks.document.update.mockResolvedValue(candidate);
    mocks.collection.findUnique.mockResolvedValue(collection);
    const response = await POST(request(), undefined);
    expect(response.status).toBe(201);
    expect(mocks.document.update).toHaveBeenCalledWith({ where: { id: 'allowed-doc' }, data: { externalId: 'stable-id' } });
  });
});
