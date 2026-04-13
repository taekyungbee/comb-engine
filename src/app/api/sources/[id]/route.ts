import { NextRequest, NextResponse } from 'next/server';
import { getSource, updateSource, deleteSource } from '@/services/source.service';
import { authenticateRequest, requireRole, AuthError } from '@/lib/api-auth';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await authenticateRequest(request);
    if (!user) {
      return NextResponse.json(
        { success: false, error: { message: "Authentication required", code: "UNAUTHORIZED" } },
        { status: 401 },
      );
    }

    const { id } = await params;
    const source = await getSource(id);
    if (!source) {
      return NextResponse.json(
        { success: false, error: { message: 'Source not found', code: 'NOT_FOUND' } },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: source });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ success: false, error: { message: error.message, code: "AUTH_ERROR" } }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: { message, code: 'GET_FAILED' } }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await authenticateRequest(request);
    if (!user) {
      return NextResponse.json(
        { success: false, error: { message: "Authentication required", code: "UNAUTHORIZED" } },
        { status: 401 },
      );
    }
    requireRole(user, "ADMIN", "MEMBER");

    const { id } = await params;
    const body = await request.json();
    const source = await updateSource(id, body);
    return NextResponse.json({ success: true, data: source });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ success: false, error: { message: error.message, code: "AUTH_ERROR" } }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: { message, code: 'UPDATE_FAILED' } }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await authenticateRequest(request);
    if (!user) {
      return NextResponse.json(
        { success: false, error: { message: "Authentication required", code: "UNAUTHORIZED" } },
        { status: 401 },
      );
    }
    requireRole(user, "ADMIN", "MEMBER");

    const { id } = await params;
    await deleteSource(id);
    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ success: false, error: { message: error.message, code: "AUTH_ERROR" } }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: { message, code: 'DELETE_FAILED' } }, { status: 500 });
  }
}
