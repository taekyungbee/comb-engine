import type { CollectorSource } from '@prisma/client';
import { BaseCollector } from './base-collector';
import type { CollectedItem } from './types';
import { translateAndSummarize } from '@/lib/llm';
import { sleep } from '@/lib/ai-core';

const MOLTBOOK_API_URL = 'https://www.moltbook.com/api/v1/posts';

const DEFAULT_SUBMOLTS = ['ai', 'technology', 'agents', 'tooling', 'infrastructure', 'security'];

export interface MoltbookConfig {
  submolts?: string[];
  maxResults?: number;
  translate?: boolean;
}

interface MoltbookAuthor {
  id: string;
  name: string;
  description: string | null;
}

interface MoltbookSubmolt {
  id: string;
  name: string;
  display_name: string;
}

interface MoltbookPost {
  id: string;
  title: string;
  content: string;
  type: string;
  author_id: string;
  author: MoltbookAuthor;
  submolt: MoltbookSubmolt;
  upvotes: number;
  downvotes: number;
  score: number;
  comment_count: number;
  created_at: string;
  updated_at: string;
}

export class MoltbookCollector extends BaseCollector {
  readonly type = 'MOLTBOOK' as const;

  validate(config: unknown): boolean {
    return true;
  }

  protected async doCollect(source: CollectorSource): Promise<CollectedItem[]> {
    const apiKey = process.env.MOLTBOOK_API_KEY;
    if (!apiKey) throw new Error('MOLTBOOK_API_KEY not configured');

    const config = (source.config ?? {}) as unknown as MoltbookConfig;
    const submolts = config.submolts ?? DEFAULT_SUBMOLTS;
    const maxResults = config.maxResults ?? 25;
    const shouldTranslate = config.translate !== false;

    // submolt별 병렬 수집
    const results = await Promise.all(
      submolts.map((submolt) => this.fetchSubmoltPosts(apiKey, submolt, maxResults)),
    );
    const allPosts = results.flat();

    // 콘텐츠 필터 (30자 미만, JSON만 있는 글 제외)
    const filtered = allPosts.filter((post) => {
      const text = (post.content ?? '').trim();
      if (text.length < 30) return false;
      if (/^\s*\{[\s\S]*\}\s*$/.test(text)) return false;
      return true;
    });

    console.log(`[Moltbook] Fetched ${allPosts.length} posts, ${filtered.length} after filter`);

    const items: CollectedItem[] = [];

    for (const post of filtered) {
      const postUrl = `https://moltbook.com/post/${post.id}`;
      let title = post.title;
      let content = post.content;
      let summary: string | undefined;
      const metadata: Record<string, unknown> = {
        originalTitle: post.title,
        originalContent: post.content,
        author: post.author.name,
        submolt: post.submolt.name,
        score: post.score,
        commentCount: post.comment_count,
      };

      if (shouldTranslate) {
        const translated = await translateAndSummarize(
          post.title,
          post.content,
          `Moltbook/${post.submolt.name}`,
        );

        if (translated) {
          title = translated.titleKo;
          content = translated.contentKo;
          summary = translated.summary;
          metadata.category = translated.category;
          metadata.importance = translated.importance;
        }

        await sleep(500);
      }

      items.push({
        externalId: post.id,
        url: postUrl,
        title,
        content,
        summary,
        metadata,
        publishedAt: new Date(post.created_at),
        tags: [post.submolt.name, ...(metadata.category ? [metadata.category as string] : [])],
      });
    }

    return items;
  }

  private async fetchSubmoltPosts(
    apiKey: string,
    submolt: string,
    limit: number,
  ): Promise<MoltbookPost[]> {
    try {
      const res = await this.fetchWithRetry(
        `${MOLTBOOK_API_URL}?sort=new&limit=${limit}&submolt=${submolt}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
        },
      );
      const data = (await res.json()) as { posts?: MoltbookPost[] };
      return data.posts ?? [];
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[Moltbook] API error for ${submolt}: ${msg}`);
      return [];
    }
  }
}
