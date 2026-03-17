import { NextRequest, NextResponse } from 'next/server';
import { listSources, createSource } from '@/services/source.service';

export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get('projectId') ?? undefined;
    const sources = await listSources(projectId);
    return NextResponse.json({ success: true, data: sources });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: { message, code: 'LIST_FAILED' } }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, type, url, config, cronExpr, enabled, tags, projectId } = body;

    if (!name || !type) {
      return NextResponse.json(
        { success: false, error: { message: 'name and type are required', code: 'VALIDATION_ERROR' } },
        { status: 400 }
      );
    }

    const source = await createSource({ name, type, url, config, cronExpr, enabled, tags, projectId });
    return NextResponse.json({ success: true, data: source }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: { message, code: 'CREATE_FAILED' } }, { status: 500 });
  }
}
