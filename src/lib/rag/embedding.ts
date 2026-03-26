import { getEmbeddingProvider, getImageEmbeddingProvider, type EmbeddingProvider } from '@/lib/ai-core';

export { getEmbeddingProvider, getImageEmbeddingProvider };
export type { EmbeddingProvider };

export const DIMENSIONS = 1024;

export async function embedImage(imagePath: string): Promise<number[]> {
  const provider = getImageEmbeddingProvider();
  return provider.embedImage(imagePath);
}
