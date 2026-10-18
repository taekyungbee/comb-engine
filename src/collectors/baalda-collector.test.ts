import { afterEach, describe, it, expect, vi } from 'vitest';
import type { CollectorSource } from '@prisma/client';
import { BaaldaCollector, resolveCutoff } from './baalda-collector';
import { baaldaConfigInputError } from './baalda-config';
import { buildChunkPayload } from '@/lib/rag/indexer';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function source(config: Record<string, unknown> = {}): CollectorSource {
  return { id: 'source', name: 'Baalda', type: 'BAALDA', config, lastRunAt: null, lastStatus: null } as CollectorSource;
}

function mockMcp(vaultNotes: Record<string, string[]>, empty: string[] = []) {
  const reads: string[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const { name, arguments: args } = JSON.parse(init.body as string).params;
    const result = name === 'list_vaults'
      ? Object.keys(vaultNotes).map((vaultId) => ({ vaultId, name: vaultId }))
      : name === 'list_notes'
        ? vaultNotes[args.vaultId].map((docId) => ({ docId, title: docId, updatedAt: '2026-10-18T00:00:00Z' }))
        : (reads.push(args.docId), { content: empty.includes(args.docId) ? ' \n ' : `Content of ${args.docId}` });
    return new Response(JSON.stringify({ result: { structuredContent: Array.isArray(result) ? { results: result } : result } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('BAALDA_MCP_TOKEN', 'test-baalda-token');
  vi.stubEnv('BAALDA_MCP_CONNECTIONS', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return { reads, fetchMock };
}

describe('Baalda MCP connection security', () => {
  it.each([
    { tokenEnv: 'AUTH_SECRET', mcpUrl: 'https://attacker.example/api/mcp' },
    { tokenEnv: 'AUTH_SECRET' },
    { mcpUrl: 'https://attacker.example/api/mcp' },
  ])('rejects untrusted connections before fetch: %j', async (config) => {
    const { fetchMock } = mockMcp({ v1: ['n1'] });
    vi.stubEnv('AUTH_SECRET', 'test-unrelated-secret');
    const result = await new BaaldaCollector().collect(source(config));
    expect(result.errors).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('test-unrelated-secret');
  });

  it('allows operator-configured pairs, rejects cross-pair combinations, and forbids redirects', async () => {
    const { fetchMock } = mockMcp({ v1: ['n1'] });
    vi.stubEnv('BAALDA_MCP_CONNECTIONS', JSON.stringify([
      { mcpUrl: 'https://team.example/api/mcp', tokenEnv: 'BAALDA_TEAM_TOKEN' },
    ]));
    vi.stubEnv('BAALDA_TEAM_TOKEN', 'test-team-token');
    const collector = new BaaldaCollector();
    expect(collector.validate({ mcpUrl: 'https://team.example/api/mcp', tokenEnv: 'BAALDA_MCP_TOKEN' })).toBe(false);
    const result = await collector.collect(source({ mcpUrl: 'https://team.example/api/mcp', tokenEnv: 'BAALDA_TEAM_TOKEN' }));
    expect(result.errors).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith('https://team.example/api/mcp', expect.objectContaining({ redirect: 'error' }));
  });

  it('rejects MEMBER connection controls and client-owned cursors', () => {
    expect(baaldaConfigInputError({ tokenEnv: 'BAALDA_MCP_TOKEN' }, 'MEMBER')?.status).toBe(403);
    expect(baaldaConfigInputError({ mcpUrl: 'https://baalda.lazyb.xyz/api/mcp' }, 'MEMBER')?.status).toBe(403);
    expect(baaldaConfigInputError({ _baaldaContinuation: null }, 'ADMIN')?.status).toBe(400);
    expect(baaldaConfigInputError({ vaultIds: ['v1'] }, 'MEMBER')).toBeNull();
  });
});

describe('Baalda continuation and tombstones', () => {
  it('resumes in stable ID order across vaults, retains the full keep set, then finishes', async () => {
    const { reads } = mockMcp({ v2: ['n4', 'n3'], v1: ['n2', 'n1'] });
    const collector = new BaaldaCollector();
    const first = await collector.collect(source({ maxNotes: 2 }));
    expect(first.items.map((i) => i.externalId)).toEqual(['n1', 'n2']);
    expect(first.continuation).toMatchObject({ afterVaultId: 'v1', afterDocId: 'n2', cutoff: null });
    expect(first.fullSync).toBe(false);
    expect(first.seenExternalIds).toBeUndefined();

    const secondSource = source({ maxNotes: 2, _baaldaContinuation: first.continuation });
    secondSource.lastStatus = 'PARTIAL';
    const second = await new BaaldaCollector().collect(secondSource);
    expect(reads).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(second.continuation).toBeNull();
    expect(second.fullSync).toBe(true);
    expect(second.seenExternalIds).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(second.syncStartedAt).toBe(first.syncStartedAt);
  });

  it('retains the original incremental cutoff despite PARTIAL status and a later lastRunAt', async () => {
    const { reads } = mockMcp({ v1: ['n3', 'n1', 'n2'] });
    const first = await new BaaldaCollector().collect(source({ since: '2026-10-17T00:00:00Z', maxNotes: 1 }));
    const next = source({ maxNotes: 2, _baaldaContinuation: first.continuation });
    next.lastRunAt = new Date('2026-10-19T00:00:00Z');
    next.lastStatus = 'PARTIAL';
    const last = await new BaaldaCollector().collect(next);
    expect(reads).toEqual(['n1', 'n2', 'n3']);
    expect(last.continuation).toBeNull();
    expect(last.fullSync).toBe(false);
  });

  it('emits tombstones for empty notes in incremental sync, consuming a cursor slot', async () => {
    mockMcp({ v1: ['n1', 'n2'] }, ['n1']);
    const result = await new BaaldaCollector().collect(source({ since: '2026-10-17T00:00:00Z', maxNotes: 1 }));
    expect(result.items).toEqual([]);
    expect(result.deletedExternalIds).toEqual(['n1']);
    expect(result.continuation?.afterDocId).toBe('n1');
  });

  it.each([0, -1, 1.5, Infinity])('rejects a maxNotes value that cannot progress: %s', (maxNotes) => {
    expect(new BaaldaCollector().validate({ maxNotes })).toBe(false);
  });
});

describe('BaaldaCollector resolveCutoff', () => {
  const ran = new Date('2026-10-17T02:05:00Z');

  it('직전 run 이 SUCCESS 면 lastRunAt 에서 10분 여유를 뺀 시각', () => {
    const cutoff = resolveCutoff({ lastRunAt: ran, lastStatus: 'SUCCESS' }, {});
    expect(cutoff?.toISOString()).toBe('2026-10-17T01:55:00.000Z');
  });

  it('직전 run 이 없거나 실패/부분이면 전체 동기화(null)', () => {
    expect(resolveCutoff({ lastRunAt: null, lastStatus: null }, {})).toBeNull();
    expect(resolveCutoff({ lastRunAt: ran, lastStatus: 'FAILED' }, {})).toBeNull();
    expect(resolveCutoff({ lastRunAt: ran, lastStatus: 'PARTIAL' }, {})).toBeNull();
  });

  it('config.since 가 lastRunAt 보다 우선, fullSync 가 최우선', () => {
    expect(resolveCutoff({ lastRunAt: ran, lastStatus: 'SUCCESS' }, { since: '2026-01-01T00:00:00Z' })?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(resolveCutoff({ lastRunAt: ran, lastStatus: 'SUCCESS' }, { since: 'not-a-date' })?.toISOString()).toBe('2026-10-17T01:55:00.000Z');
    expect(resolveCutoff({ lastRunAt: ran, lastStatus: 'SUCCESS' }, { fullSync: true })).toBeNull();
  });
});

describe('buildChunkPayload', () => {
  it('검색 필터 키(project_id/source_type/document_id)를 넣고 빈 값은 생략', () => {
    const payload = buildChunkPayload({ id: 'c1', content: 'hello' }, 'd1', 'BAALDA', {
      title: 'T',
      projectId: 'p1',
      collectionId: null,
      url: undefined,
    });
    expect(payload).toEqual({
      chunk_id: 'c1',
      content: 'hello',
      title: 'T',
      source_type: 'BAALDA',
      document_id: 'd1',
      project_id: 'p1',
    });
  });
});
