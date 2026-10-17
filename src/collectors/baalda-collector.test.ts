import { describe, it, expect } from 'vitest';
import { resolveCutoff } from './baalda-collector';
import { buildChunkPayload } from '@/lib/rag/indexer';

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
