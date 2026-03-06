import { NextRequest, NextResponse } from 'next/server';
import { runCollection } from '@/services/collection.service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sourceId, sourceIds } = body;

    const ids: string[] = sourceIds ?? (sourceId ? [sourceId] : []);
    if (ids.length === 0) {
      return NextResponse.json(
        { success: false, error: { message: 'sourceId or sourceIds required', code: 'VALIDATION_ERROR' } },
        { status: 400 }
      );
    }

    const results: { sourceId: string; runId?: string; error?: string }[] = [];

    for (const id of ids) {
      try {
        const runId = await runCollection(id);
        results.push({ sourceId: id, runId });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({ sourceId: id, error: message });
      }
    }

    return NextResponse.json({ success: true, data: { results } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: { message, code: 'COLLECT_FAILED' } }, { status: 500 });
  }
}
