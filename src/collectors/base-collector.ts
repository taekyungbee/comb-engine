import type { CollectorSource } from '@prisma/client';
import type { Collector, CollectorResult, CollectedItem } from './types';
import { sleep } from '@/lib/ai-core';

export abstract class BaseCollector implements Collector {
  abstract readonly type: CollectorSource['type'];
  abstract validate(config: unknown): boolean;

  protected abstract doCollect(source: CollectorSource): Promise<CollectedItem[]>;

  async collect(source: CollectorSource): Promise<CollectorResult> {
    const errors: string[] = [];
    let items: CollectedItem[] = [];

    try {
      items = await this.doCollect(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      console.error(`[${this.type}] Collection failed for ${source.name}:`, message);
    }

    return { items, errors };
  }

  protected async fetchWithRetry(
    url: string,
    options: RequestInit = {},
    retries = 3
  ): Promise<Response> {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            'User-Agent': 'RAGCollector/1.0',
            ...options.headers,
          },
        });
        if (response.ok) return response;
        if (response.status === 429 && i < retries - 1) {
          await sleep(2000 * (i + 1));
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        if (i === retries - 1) throw error;
        await sleep(1000 * (i + 1));
      }
    }
    throw new Error('Unreachable');
  }
}
