import type { CollectorSource } from '@prisma/client';
import { BaseCollector } from './base-collector';
import type { CollectedItem, CollectorResult, BaaldaConfig } from './types';
import { resolveBaaldaConnection } from './baalda-config';

/**
 * Baalda Collector — baalda(노트 앱) MCP 엔드포인트에서 노트를 읽어 수집 (LAZ-780, PLAN.md Phase 5)
 *
 * 소스는 baalda MCP(`POST /api/mcp`, JSON-RPC 2.0, Bearer `mcp_…` 토큰)다.
 * baalda Postgres 는 별도 compose 네트워크라 comb-engine 컨테이너에서 직접 닿지 않고,
 * `note_index` 는 파생 캐시라 문서화된 계약은 MCP 뿐이다.
 *
 * 토큰은 config 에 두지 않고 환경변수(기본 BAALDA_MCP_TOKEN)로 읽는다. 토큰 하나는 조직(org) 하나에
 * 묶이므로 조직이 여럿이면 소스를 조직별로 만든다(tokenEnv 로 변수명 분리).
 *
 * 증분: `list_notes` 의 updatedAt 이 기준(cutoff) 이후인 노트만 `read_note` 한다.
 *   cutoff = config.since > source.lastRunAt(직전 run 이 SUCCESS 일 때, 10분 여유) > 없으면 전체.
 * 전체 동기화일 때는 seenExternalIds 를 돌려줘 collection.service 가 사라진 노트의 문서를 지운다.
 *
 * config 예시: { "vaultIds": ["7e7e…"] }. 접속 설정은 서버 허용 목록 + ADMIN 전용.
 */

const DEFAULT_MAX_NOTES = 2000;
const INCREMENTAL_MARGIN_MS = 10 * 60 * 1000;

interface McpVault { vaultId: string; name: string }
interface McpNote {
  docId: string;
  folderId: string | null;
  title: string;
  relPath: string;
  permission: string;
  updatedAt: string;
}
interface McpReadNote {
  docId: string;
  vaultId: string;
  folderId: string | null;
  title: string;
  relPath: string;
  content: string;
  revision?: string;
}

export class BaaldaCollector extends BaseCollector {
  readonly type = 'BAALDA' as const;
  private seq = 0;

  validate(config: unknown): boolean {
    if (config !== null && config !== undefined && (typeof config !== 'object' || Array.isArray(config))) return false;
    const c = (config ?? {}) as BaaldaConfig;
    if (c.vaultIds !== undefined && (!Array.isArray(c.vaultIds) || c.vaultIds.some((id) => typeof id !== 'string'))) return false;
    if (c.maxNotes !== undefined && (!Number.isSafeInteger(c.maxNotes) || c.maxNotes < 1)) return false;
    try { resolveBaaldaConnection(c); return true; } catch { return false; }
  }

  async collect(source: CollectorSource): Promise<CollectorResult> {
    try {
      return await this.run(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${this.type}] Collection failed for ${source.name}:`, message);
      return { items: [], errors: [message] };
    }
  }

  protected async doCollect(source: CollectorSource): Promise<CollectedItem[]> {
    return (await this.run(source)).items;
  }

  private async run(source: CollectorSource): Promise<CollectorResult> {
    const cfg = (source.config ?? {}) as BaaldaConfig;
    if (!this.validate(cfg)) throw new Error('Invalid Baalda collector config');
    // Validate the pair BEFORE reading any environment secret or sending any request.
    const { tokenEnv, mcpUrl } = resolveBaaldaConnection(cfg);
    const token = process.env[tokenEnv];
    if (!token) throw new Error(`baalda MCP 토큰 환경변수 ${tokenEnv} 가 비어 있습니다`);
    const maxNotes = cfg.maxNotes ?? DEFAULT_MAX_NOTES;
    const cursor = cfg._baaldaContinuation;
    const startedAt = cursor?.startedAt ?? new Date().toISOString();
    const cutoff = cursor ? (cursor.cutoff ? new Date(cursor.cutoff) : null) : resolveCutoff(source, cfg);

    const vaults = await this.call<McpVault[]>(mcpUrl, token, 'list_vaults', {});
    const targets = (cfg.vaultIds?.length
      ? vaults.filter((v) => cfg.vaultIds!.includes(v.vaultId))
      : vaults).sort((a, b) => a.vaultId < b.vaultId ? -1 : a.vaultId > b.vaultId ? 1 : 0);
    if (targets.length === 0) throw new Error('수집 대상 vault 가 없습니다 (vaultIds 확인)');

    const items: CollectedItem[] = [];
    const seen: string[] = [];
    const deletedExternalIds: string[] = [];
    let read = 0;
    let truncated = false;
    let afterVaultId = cursor?.afterVaultId ?? '';
    let afterDocId = cursor?.afterDocId ?? '';

    for (const vault of targets) {
      const notes = (await this.call<McpNote[]>(mcpUrl, token, 'list_notes', { vaultId: vault.vaultId }))
        .sort((a, b) => a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0);
      let changed = 0;
      for (const n of notes) {
        seen.push(n.docId);
        if (cursor && (vault.vaultId < cursor.afterVaultId ||
          (vault.vaultId === cursor.afterVaultId && n.docId <= cursor.afterDocId))) continue;
        if (cutoff && new Date(n.updatedAt).getTime() <= cutoff.getTime()) continue;
        // Keep enumerating for the final full-sync keep set; only note reads are bounded.
        if (read >= maxNotes) { truncated = true; continue; }

        const note = await this.call<McpReadNote>(mcpUrl, token, 'read_note', { docId: n.docId });
        read++;
        afterVaultId = vault.vaultId;
        afterDocId = n.docId;
        const body = (note.content ?? '').trim();
        if (!body) { deletedExternalIds.push(n.docId); continue; }

        const relPath = n.relPath || note.relPath || '';
        const slash = relPath.lastIndexOf('/');
        const folderPath = slash > 0 ? relPath.slice(0, slash) : '';
        const title = note.title || n.title || relPath;
        const header = `[baalda | vault:${vault.name} | 경로:${relPath} | 수정:${n.updatedAt}]`;

        items.push({
          externalId: n.docId,
          title: `[baalda/${vault.name}] ${folderPath ? `${folderPath}/` : ''}${title}`,
          content: `${header}\n${body}`,
          metadata: {
            docId: n.docId,
            vaultId: vault.vaultId,
            vaultName: vault.name,
            folderId: n.folderId,
            folderPath,
            relPath,
            updatedAt: n.updatedAt,
            revision: note.revision ?? null,
            permission: n.permission,
          },
          publishedAt: new Date(n.updatedAt),
          tags: [
            'baalda',
            `vault:${vault.name}`,
            ...(folderPath ? [`folder:${folderPath.split('/')[0]}`] : []),
          ],
        });
        changed++;
      }
      console.log(
        `[BaaldaCollector] ${source.name} vault "${vault.name}": 노트 ${notes.length}개 중 ${changed}개 수집` +
          (cutoff ? ` (증분 기준 ${cutoff.toISOString()})` : ' (전체)'),
      );
    }

    return {
      items,
      errors: [],
      deletedExternalIds,
      continuation: truncated ? { startedAt, cutoff: cutoff?.toISOString() ?? null, afterVaultId, afterDocId } : null,
      syncStartedAt: startedAt,
      fullSync: cutoff === null && !truncated,
      seenExternalIds: cutoff === null && !truncated ? seen : undefined,
    };
  }

  /** baalda MCP tools/call — structuredContent(배열은 results 로 감쌈) 우선, 없으면 content[0].text JSON */
  private async call<T>(mcpUrl: string, token: string, name: string, args: Record<string, unknown>): Promise<T> {
    const res = await this.fetchWithRetry(mcpUrl, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.seq, method: 'tools/call', params: { name, arguments: args } }),
    });
    const json = (await res.json()) as {
      error?: { code: number; message: string };
      result?: {
        isError?: boolean;
        content?: Array<{ type: string; text?: string }>;
        structuredContent?: unknown;
      };
    };
    if (json.error) throw new Error(`baalda MCP ${name}: ${json.error.message} (${json.error.code})`);
    const result = json.result;
    if (!result) throw new Error(`baalda MCP ${name}: 빈 응답`);
    const text = result.content?.find((c) => c.type === 'text')?.text ?? '';
    if (result.isError) throw new Error(`baalda MCP ${name}: ${text || 'tool error'}`);
    const sc = result.structuredContent as Record<string, unknown> | undefined;
    if (sc && typeof sc === 'object' && Array.isArray((sc as { results?: unknown }).results)) {
      return (sc as { results: T }).results;
    }
    if (sc && typeof sc === 'object') return sc as T;
    return JSON.parse(text) as T;
  }
}

export function resolveCutoff(source: Pick<CollectorSource, 'lastRunAt' | 'lastStatus'>, cfg: BaaldaConfig): Date | null {
  if (cfg.fullSync) return null;
  if (cfg.since) {
    const d = new Date(cfg.since);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (source.lastRunAt && source.lastStatus === 'SUCCESS') {
    return new Date(source.lastRunAt.getTime() - INCREMENTAL_MARGIN_MS);
  }
  return null;
}
