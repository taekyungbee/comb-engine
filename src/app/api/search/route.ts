import { NextRequest, NextResponse } from 'next/server';
import { searchSimilar } from '@/services/search.service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, limit, threshold, sourceTypes, tags, projectId, collectionIds } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { success: false, error: { message: 'query is required', code: 'VALIDATION_ERROR' } },
        { status: 400 }
      );
    }

    const results = await searchSimilar(query, { limit, threshold, sourceTypes, tags, projectId, collectionIds });
    return NextResponse.json({ success: true, data: { results, count: results.length } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: { message, code: 'SEARCH_FAILED' } }, { status: 500 });
  }
}
