import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, requireRole, AuthError } from '@/lib/api-auth';
import { indexItem } from '@/lib/rag/indexer';
import { embedImage } from '@/lib/rag/embedding';
import { createHash } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { rateLimitMiddleware } from '@/middleware/rate-limit';

const rateLimit = rateLimitMiddleware({ limit: 1000, windowMs: 60000 });

// API를 통한 수집을 위한 가상 소스 찾기/생성 (projectId별 분리)
async function getApiIngestSource(projectId?: string): Promise<string> {
  const existing = await prisma.collectorSource.findFirst({
    where: { type: 'API_INGEST', projectId: projectId ?? null },
  });

  if (existing) return existing.id;

  const source = await prisma.collectorSource.create({
    data: {
      name: projectId ? `API Ingest (${projectId})` : 'API Ingest',
      type: 'API_INGEST',
      enabled: true,
      config: {},
      projectId,
    },
  });

  return source.id;
}

async function handler(request: NextRequest) {
  try {
    const user = requireRole(await authenticateRequest(request), 'ADMIN', 'MEMBER');

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      return handleImageIngest(request, user.userId);
    }

    return handleTextIngest(request, user.userId);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: { message: error.message, code: 'AUTH_ERROR' } },
        { status: error.statusCode }
      );
    }
    console.error('Ingest error:', error);
    return NextResponse.json(
      { success: false, error: { message: '수집 처리 중 오류가 발생했습니다.', code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}

export const POST = rateLimit(handler);

async function handleTextIngest(request: NextRequest, userId: string) {
  const { title, content, url, tags, collectionId, projectId, metadata } = await request.json();

  if (!title || !content) {
    return NextResponse.json(
      { success: false, error: { message: 'title과 content가 필요합니다.', code: 'MISSING_FIELDS' } },
      { status: 400 }
    );
  }

  // collectionId 접근 권한 확인
  if (collectionId) {
    const collection = await prisma.collection.findUnique({ where: { id: collectionId } });
    if (!collection || (collection.ownerId !== userId && collection.visibility === 'PRIVATE')) {
      return NextResponse.json(
        { success: false, error: { message: '컬렉션에 접근할 수 없습니다.', code: 'FORBIDDEN' } },
        { status: 403 }
      );
    }
  }

  const sourceId = await getApiIngestSource(projectId);
  const externalId = createHash('sha256').update(`${title}:${Date.now()}`).digest('hex').slice(0, 32);

  const result = await indexItem({
    sourceId,
    sourceType: 'API_INGEST',
    externalId,
    url,
    title,
    content,
    tags: tags || [],
    metadata: metadata || {},
    collectionId,
    projectId,
  });

  return NextResponse.json({ success: true, data: { status: result } }, { status: 201 });
}

async function handleImageIngest(request: NextRequest, userId: string) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const title = formData.get('title') as string;
  const collectionId = formData.get('collectionId') as string | null;
  const projectId = formData.get('projectId') as string | null;
  const tagsRaw = formData.get('tags') as string | null;

  if (!file || !title) {
    return NextResponse.json(
      { success: false, error: { message: 'file과 title이 필요합니다.', code: 'MISSING_FIELDS' } },
      { status: 400 }
    );
  }

  // collectionId 접근 권한 확인
  if (collectionId) {
    const collection = await prisma.collection.findUnique({ where: { id: collectionId } });
    if (!collection || (collection.ownerId !== userId && collection.visibility === 'PRIVATE')) {
      return NextResponse.json(
        { success: false, error: { message: '컬렉션에 접근할 수 없습니다.', code: 'FORBIDDEN' } },
        { status: 403 }
      );
    }
  }

  // 파일 저장
  const uploadsDir = path.join(process.cwd(), 'uploads');
  await mkdir(uploadsDir, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name) || '.png';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const filePath = path.join(uploadsDir, fileName);
  await writeFile(filePath, buffer);

  const sourceId = await getApiIngestSource(projectId ?? undefined);
  const contentHash = createHash('sha256').update(buffer).digest('hex');

  // Document 생성
  const doc = await prisma.document.create({
    data: {
      sourceId,
      sourceType: 'API_INGEST',
      contentType: 'IMAGE',
      externalId: contentHash.slice(0, 32),
      title,
      content: `[Image: ${file.name}]`,
      contentHash,
      collectionId,
      projectId,
      tags: tagsRaw ? tagsRaw.split(',').map((t) => t.trim()) : [],
      metadata: { fileName: file.name, filePath, mimeType: file.type, size: file.size },
    },
  });

  // 이미지 임베딩 생성
  const embedding = await embedImage(filePath);

  // 단일 청크로 저장
  const chunk = await prisma.documentChunk.create({
    data: {
      documentId: doc.id,
      content: `[Image: ${title}]`,
      chunkIndex: 0,
      tokenCount: 0,
    },
  });

  // 이미지 임베딩은 Gemini 3072d — 별도 Qdrant 컬렉션 필요 (TODO)
  const vectorStr = `[${embedding.join(',')}]`;
  await prisma.$executeRawUnsafe(
    `UPDATE document_chunks SET embedding = $1::vector WHERE id = $2::uuid`,
    vectorStr,
    chunk.id
  );

  return NextResponse.json(
    { success: true, data: { documentId: doc.id, status: 'new' } },
    { status: 201 }
  );
}
