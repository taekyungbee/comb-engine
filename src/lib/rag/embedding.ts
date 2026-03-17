import { prisma } from '@/lib/prisma';
import { getEmbeddingProvider, type EmbeddingProvider } from '@/lib/ai-core';

export { getEmbeddingProvider };
export type { EmbeddingProvider };

const DIMENSIONS = 3072;

export async function initVectorExtension(): Promise<void> {
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');

  await prisma.$executeRawUnsafe(`
    ALTER TABLE document_chunks
    ADD COLUMN IF NOT EXISTS embedding vector(${DIMENSIONS})
  `);
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

export async function embedImage(imagePath: string): Promise<number[]> {
  const provider = getEmbeddingProvider();
  return provider.embedImage(imagePath);
}
