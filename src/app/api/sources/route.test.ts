import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ createSource: vi.fn(), updateSource: vi.fn() }));
vi.mock('@/services/source.service', () => mocks);
vi.mock('@/lib/api-auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({ userId: 'member', role: 'MEMBER' }),
  requireRole: (user: unknown) => user,
  AuthError: class extends Error { constructor(message: string, public statusCode: number) { super(message); } },
}));
import { POST } from './route';
import { PUT } from './[id]/route';

beforeEach(() => { vi.clearAllMocks(); });
describe('MEMBER Baalda source config', () => {
  it.each([{ tokenEnv: 'AUTH_SECRET' }, { mcpUrl: 'https://attacker.example/api/mcp' }])('rejects connection controls on POST and PUT: %j', async (config) => {
    const request = () => new NextRequest('http://localhost/api/sources', { method: 'POST', body: JSON.stringify({ name: 'source', type: 'BAALDA', config }) });
    expect((await POST(request())).status).toBe(403);
    expect((await PUT(request(), { params: Promise.resolve({ id: 's1' }) })).status).toBe(403);
    expect(mocks.createSource).not.toHaveBeenCalled();
    expect(mocks.updateSource).not.toHaveBeenCalled();
  });
});
