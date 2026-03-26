import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_URL = process.env.QDRANT_URL || 'http://192.168.0.67:6333';
const COLLECTION = process.env.QDRANT_COLLECTION || 'rag_production';

let client: QdrantClient | null = null;

export function getQdrantClient(): QdrantClient {
  if (!client) {
    client = new QdrantClient({ url: QDRANT_URL });
  }
  return client;
}

export function getCollectionName(): string {
  return COLLECTION;
}

/** 텍스트 → sparse vector (TF 기반) */
export function textToSparse(text: string): { indices: number[]; values: number[] } {
  const words = text.toLowerCase().split(/[\s.,;:!?()[\]{}"'/\\]+/);
  const tf = new Map<number, number>();

  for (const w of words) {
    if (w.length < 2) continue;
    // 간단한 해시 함수로 인덱스 생성 (vocab 관리 불필요)
    let hash = 0;
    for (let i = 0; i < w.length; i++) {
      hash = ((hash << 5) - hash + w.charCodeAt(i)) & 0x7fffffff;
    }
    const idx = hash % 1000000; // 100만 범위
    tf.set(idx, (tf.get(idx) || 0) + 1);
  }

  const maxTf = Math.max(...tf.values(), 1);
  const indices = [...tf.keys()];
  const values = indices.map((i) => (tf.get(i) || 0) / maxTf);

  return { indices, values };
}
