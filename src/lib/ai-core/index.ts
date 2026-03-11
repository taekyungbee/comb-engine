import { GoogleGenAI } from '@google/genai';

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  embedImage(imagePath: string): Promise<number[]>;
  readonly dimensions: number;
  readonly modelName: string;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private client: GoogleGenAI;
  readonly dimensions = 1536;
  readonly modelName = 'gemini-embedding-001';

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.client.models.embedContent({
      model: this.modelName,
      contents: text,
    });
    return result.embeddings?.[0]?.values ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const BATCH_SIZE = 100;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (text) => {
          const result = await this.client.models.embedContent({
            model: this.modelName,
            contents: text,
          });
          return result.embeddings?.[0]?.values ?? [];
        })
      );
      allEmbeddings.push(...results);
    }

    return allEmbeddings;
  }

  async embedImage(imagePath: string): Promise<number[]> {
    const fs = await import('fs');
    const path = await import('path');
    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase().replace('.', '');
    const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;

    const result = await this.client.models.embedContent({
      model: this.modelName,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64,
            },
          },
        ],
      },
    });
    return result.embeddings?.[0]?.values ?? [];
  }
}

let provider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (provider) return provider;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 환경 변수가 설정되지 않았습니다.');

  provider = new GeminiEmbeddingProvider(apiKey);
  return provider;
}

export interface TextChunk {
  text: string;
  index: number;
  metadata?: Record<string, string>;
}

export function chunkText(
  text: string,
  options: { chunkSize?: number; overlap?: number } = {}
): TextChunk[] {
  const { chunkSize = 500, overlap = 50 } = options;
  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push({ text: text.slice(start, end).trim(), index });
    start += chunkSize - overlap;
    index++;
  }

  return chunks.filter((c) => c.text.length > 0);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
