// @side/ai-core에서 필요한 부분만 추출 (외부 의존성 제거)

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly modelName: string;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;
  readonly dimensions: number;
  readonly modelName: string;

  constructor(
    baseUrl: string = 'http://localhost:11434',
    model: string = 'nomic-embed-text',
    dimensions: number = 768
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.modelName = model;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.modelName, input: text }),
    });
    if (!response.ok) throw new Error(`Ollama embedding error: ${response.status}`);
    const data = await response.json();
    return data.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.modelName, input: texts }),
    });
    if (!response.ok) throw new Error(`Ollama embedding error: ${response.status}`);
    const data = await response.json();
    return data.embeddings;
  }
}

export type EmbeddingModelType = 'openai' | 'ollama';

export function createEmbeddingProvider(
  type: EmbeddingModelType,
  config: {
    apiKey?: string;
    url?: string;
    model?: string;
    dimensions?: number;
  }
): EmbeddingProvider {
  if (type === 'ollama') {
    return new OllamaEmbeddingProvider(config.url, config.model, config.dimensions);
  }
  throw new Error(`Unsupported embedding provider: ${type}. Only ollama is supported in standalone mode.`);
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
