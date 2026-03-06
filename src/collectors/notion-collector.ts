import type { CollectorSource } from '@prisma/client';
import { BaseCollector } from './base-collector';
import type { CollectedItem, NotionPageConfig } from './types';
import { Client } from '@notionhq/client';

export class NotionCollector extends BaseCollector {
  readonly type = 'NOTION_PAGE' as const;

  validate(config: unknown): boolean {
    const c = config as NotionPageConfig;
    return !!c?.pageId;
  }

  protected async doCollect(source: CollectorSource): Promise<CollectedItem[]> {
    const config = source.config as unknown as NotionPageConfig;
    if (!config?.pageId) throw new Error('pageId is required');

    const apiKey = process.env.NOTION_API_KEY;
    if (!apiKey) throw new Error('NOTION_API_KEY is required');

    const notion = new Client({ auth: apiKey });
    const items: CollectedItem[] = [];

    await this.collectPage(notion, config.pageId, items, config.recursive ?? false);

    return items;
  }

  private async collectPage(
    notion: Client,
    pageId: string,
    items: CollectedItem[],
    recursive: boolean
  ): Promise<void> {
    try {
      const page = await notion.pages.retrieve({ page_id: pageId });
      const blocks = await this.getAllBlocks(notion, pageId);
      const content = this.blocksToText(blocks);

      const titleProp = Object.values((page as Record<string, unknown> & { properties: Record<string, unknown> }).properties).find(
        (p: unknown) => (p as { type: string }).type === 'title'
      ) as { title: Array<{ plain_text: string }> } | undefined;

      const title = titleProp?.title?.map((t) => t.plain_text).join('') || 'Untitled';

      if (content.trim().length > 10) {
        items.push({
          externalId: pageId,
          url: `https://notion.so/${pageId.replace(/-/g, '')}`,
          title,
          content,
          metadata: {
            pageId,
            lastEditedTime: (page as { last_edited_time?: string }).last_edited_time,
          },
        });
      }

      // 하위 페이지 재귀 수집
      if (recursive) {
        for (const block of blocks) {
          if ((block as { type: string }).type === 'child_page') {
            await this.collectPage(notion, (block as { id: string }).id, items, true);
          }
        }
      }
    } catch (error) {
      console.warn(`[Notion] Failed to collect page ${pageId}:`, error);
    }
  }

  private async getAllBlocks(notion: Client, blockId: string): Promise<unknown[]> {
    const blocks: unknown[] = [];
    let cursor: string | undefined;

    do {
      const response = await notion.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100,
      });
      blocks.push(...response.results);
      cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);

    return blocks;
  }

  private blocksToText(blocks: unknown[]): string {
    return blocks
      .map((block) => {
        const b = block as Record<string, unknown>;
        const type = b.type as string;
        const data = b[type] as { rich_text?: Array<{ plain_text: string }> } | undefined;

        if (data?.rich_text) {
          const text = data.rich_text.map((t) => t.plain_text).join('');
          if (type.startsWith('heading')) return `\n## ${text}\n`;
          if (type === 'bulleted_list_item') return `- ${text}`;
          if (type === 'numbered_list_item') return `1. ${text}`;
          if (type === 'to_do') return `- [ ] ${text}`;
          if (type === 'code') return `\`\`\`\n${text}\n\`\`\``;
          return text;
        }

        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
}
