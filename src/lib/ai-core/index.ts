export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  embedImage(imagePath: string): Promise<number[]>;
  readonly dimensions: number;
  readonly modelName: string;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;
  readonly dimensions = 768;
  readonly modelName = 'nomic-embed-text';

  constructor(baseUrl: string = 'http://192.168.0.81:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.modelName, input: text }),
    });
    if (!res.ok) throw new Error(`Ollama embedding error: ${res.status}`);
    const data = await res.json();
    return data.embeddings?.[0] ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const BATCH_SIZE = 100;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (text) => {
          const res = await fetch(`${this.baseUrl}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: this.modelName, input: text }),
          });
          if (!res.ok) return [];
          const data = await res.json();
          return data.embeddings?.[0] ?? [];
        })
      );
      allEmbeddings.push(...results);
    }

    return allEmbeddings;
  }

  async embedImage(imagePath: string): Promise<number[]> {
    // Ollama는 이미지 임베딩을 직접 지원하지 않으므로
    // 일단 dummy 값 반환 (향후 vision 모델 추가 시 구현)
    return new Array(this.dimensions).fill(0);
  }
}

let provider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (provider) return provider;

  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://192.168.0.81:11434';
  provider = new OllamaEmbeddingProvider(baseUrl);
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
