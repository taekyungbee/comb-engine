export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  embedImage(imagePath: string): Promise<number[]>;
  readonly dimensions: number;
  readonly modelName: string;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  readonly dimensions = 3072;
  readonly modelName = 'gemini-embedding-2-preview';
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(
      `${this.baseUrl}/models/${this.modelName}:embedContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${this.modelName}`,
          content: { parts: [{ text }] },
        }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini embedding error: ${res.status} ${err}`);
    }
    const data = await res.json();
    return data.embedding?.values ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const BATCH_SIZE = 100;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const requests = batch.map((text) => ({
        model: `models/${this.modelName}`,
        content: { parts: [{ text }] },
      }));

      const res = await fetch(
        `${this.baseUrl}/models/${this.modelName}:batchEmbedContents?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests }),
        },
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Gemini batch embedding error: ${res.status} ${err}`);
      }

      const data = await res.json();
      const embeddings = (data.embeddings ?? []).map(
        (e: { values: number[] }) => e.values,
      );
      allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
  }

  async embedImage(imagePath: string): Promise<number[]> {
    const fs = await import('fs');
    const imageBytes = fs.readFileSync(imagePath);
    const base64 = imageBytes.toString('base64');
    const ext = imagePath.split('.').pop()?.toLowerCase() || 'png';
    const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;

    const res = await fetch(
      `${this.baseUrl}/models/${this.modelName}:embedContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${this.modelName}`,
          content: {
            parts: [{ inline_data: { mime_type: mimeType, data: base64 } }],
          },
        }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini image embedding error: ${res.status} ${err}`);
    }
    const data = await res.json();
    return data.embedding?.values ?? [];
  }
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1024;
  readonly modelName = 'bge-m3';
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.OLLAMA_URL || 'http://localhost:11434';
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.modelName, input: text }),
    });
    if (!res.ok) throw new Error(`Ollama embed error: ${res.status}`);
    const data = await res.json();
    return data.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.modelName, input: texts }),
    });
    if (!res.ok) throw new Error(`Ollama embedBatch error: ${res.status}`);
    const data = await res.json();
    return data.embeddings;
  }

  async embedImage(_imagePath: string): Promise<number[]> {
    throw new Error('Ollama nomic-embed-text는 이미지 임베딩을 지원하지 않습니다. Gemini를 사용하세요.');
  }
}

let provider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (provider) return provider;

  // 텍스트 임베딩: Ollama nomic-embed-text (로컬, 768d)
  // 이미지 임베딩: getImageEmbeddingProvider() 사용
  provider = new OllamaEmbeddingProvider();
  return provider;
}

/** 이미지 전용 Gemini 임베딩 프로바이더 */
export function getImageEmbeddingProvider(): EmbeddingProvider {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    throw new Error('이미지 임베딩에는 GEMINI_API_KEY가 필요합니다.');
  }
  return new GeminiEmbeddingProvider(apiKey);
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

  return chunks.filter((c) => c.text.length >= 10);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
