import { prisma } from '@/lib/prisma';
import {
  createEmbeddingProvider,
  type EmbeddingProvider,
  type EmbeddingModelType,
} from '@/lib/ai-core';

let embeddingProvider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (embeddingProvider) return embeddingProvider;

  const providerType = (process.env.EMBEDDING_PROVIDER || 'ollama') as EmbeddingModelType;

  embeddingProvider = createEmbeddingProvider(providerType, {
    apiKey: process.env.OPENAI_API_KEY,
    url: process.env.OLLAMA_URL || 'http://192.168.0.67:11434',
    model: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
    dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '768'),
  });

  return embeddingProvider;
}

export async function initVectorExtension(): Promise<void> {
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');

  const dimensions = parseInt(process.env.EMBEDDING_DIMENSIONS || '768');

  await prisma.$executeRawUnsafe(`
    ALTER TABLE document_chunks
    ADD COLUMN IF NOT EXISTS embedding vector(${dimensions})
  `);

  // IVFFlat 인덱스는 최소 데이터가 있어야 생성 가능 — 데이터 추가 후 별도 호출
}

export async function createVectorIndex(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
    ON document_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
  `);
}

export async function saveChunkEmbedding(
  chunkId: string,
  embedding: number[]
): Promise<void> {
  const vectorStr = `[${embedding.join(',')}]`;
  await prisma.$executeRawUnsafe(
    `UPDATE document_chunks SET embedding = $1::vector WHERE id = $2::uuid`,
    vectorStr,
    chunkId
  );
}

export async function embedAndSaveChunks(
  chunks: { id: string; text: string }[]
): Promise<void> {
  if (chunks.length === 0) return;

  const provider = getEmbeddingProvider();
  const texts = chunks.map((c) => c.text);
  const embeddings = await provider.embedBatch(texts);

  for (let i = 0; i < chunks.length; i++) {
    await saveChunkEmbedding(chunks[i].id, embeddings[i]);
  }
}
