import type { BaaldaConfig } from './types';

const DEFAULT_CONNECTION = {
  mcpUrl: 'https://baalda.lazyb.xyz/api/mcp',
  tokenEnv: 'BAALDA_MCP_TOKEN',
};

/** Additional destination/token pairs are configured by the server operator, never source input. */
export function resolveBaaldaConnection(config: BaaldaConfig) {
  const connections = [DEFAULT_CONNECTION];
  if (process.env.BAALDA_MCP_CONNECTIONS) {
    const extra: unknown = JSON.parse(process.env.BAALDA_MCP_CONNECTIONS);
    if (!Array.isArray(extra) || extra.some((c) =>
      !c || typeof c.mcpUrl !== 'string' || !/^https:\/\//.test(c.mcpUrl) ||
      typeof c.tokenEnv !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(c.tokenEnv),
    )) throw new Error('Invalid server BAALDA_MCP_CONNECTIONS allowlist');
    connections.push(...extra);
  }
  const mcpUrl = config.mcpUrl ?? DEFAULT_CONNECTION.mcpUrl;
  const tokenEnv = config.tokenEnv ?? DEFAULT_CONNECTION.tokenEnv;
  if (!connections.some((c) => c.mcpUrl === mcpUrl && c.tokenEnv === tokenEnv)) {
    throw new Error('Baalda MCP connection is not in the server allowlist');
  }
  return { mcpUrl, tokenEnv };
}

/** Cursor state must only come from the collection service, including for ADMIN input. */
export function baaldaConfigInputError(config: unknown, role: string): { message: string; status: number } | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  if ('_baaldaContinuation' in config) {
    return { message: 'Baalda continuation is managed by the server', status: 400 };
  }
  if (role !== 'ADMIN' && ('mcpUrl' in config || 'tokenEnv' in config)) {
    return { message: 'Only ADMIN may select a Baalda MCP connection', status: 403 };
  }
  if ('mcpUrl' in config || 'tokenEnv' in config) {
    try { resolveBaaldaConnection(config as BaaldaConfig); }
    catch { return { message: 'Baalda MCP connection is not in the server allowlist', status: 400 }; }
  }
  return null;
}
