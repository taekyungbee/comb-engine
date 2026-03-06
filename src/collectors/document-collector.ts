import type { CollectorSource } from '@prisma/client';
import { BaseCollector } from './base-collector';
import type { CollectedItem, DocumentFileConfig } from './types';
import { readFile } from 'fs/promises';
import { basename } from 'path';
import { createHash } from 'crypto';

export class DocumentCollector extends BaseCollector {
  readonly type = 'DOCUMENT_FILE' as const;

  validate(config: unknown): boolean {
    const c = config as DocumentFileConfig;
    return !!c?.filePath && !!c?.fileType;
  }

  protected async doCollect(source: CollectorSource): Promise<CollectedItem[]> {
    const config = source.config as unknown as DocumentFileConfig;
    if (!config?.filePath) throw new Error('filePath is required');

    const items: CollectedItem[] = [];
    const fileType = config.fileType || 'txt';

    let content: string;
    const fileName = basename(config.filePath);

    switch (fileType) {
      case 'pdf':
        content = await this.parsePdf(config.filePath);
        break;
      case 'md':
      case 'txt':
        content = await readFile(config.filePath, 'utf-8');
        break;
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }

    if (content.trim().length > 10) {
      items.push({
        externalId: createHash('md5').update(config.filePath).digest('hex'),
        url: `file://${config.filePath}`,
        title: fileName,
        content,
        metadata: {
          filePath: config.filePath,
          fileType,
        },
      });
    }

    return items;
  }

  private async parsePdf(filePath: string): Promise<string> {
    const pdfParse = (await import('pdf-parse')).default;
    const buffer = await readFile(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }
}
