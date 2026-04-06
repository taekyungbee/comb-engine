import { NextRequest, NextResponse } from "next/server";
import { type SourceType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticateRequest, AuthError } from "@/lib/api-auth";

/**
 * GET /api/documents/recent
 *
 * 최근 수집된 문서 목록 반환.
 * collection-trigger 등 외부 자동화 도구에서 신규 수집 항목을 폴링할 때 사용.
 *
 * Query params:
 *   since       - ISO 8601 날짜/시간. 이 시간 이후 collected_at 필터 (기본: 24시간 전)
 *   limit       - 최대 반환 수 (기본 50, 최대 200)
 *   projectId   - 프로젝트 ID 필터 (선택)
 *   sourceType  - 소스 타입 필터 (선택, 콤마 구분 다중 가능)
 */
export async function GET(request: NextRequest) {
  try {
    const authUser = await authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json(
        {
          success: false,
          error: { message: "Authentication required", code: "UNAUTHORIZED" },
        },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);

    // since: 기본값 24시간 전
    const sinceParam = searchParams.get("since");
    const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (isNaN(since.getTime())) {
      return NextResponse.json(
        {
          success: false,
          error: { message: "'since' 파라미터가 유효한 날짜가 아닙니다.", code: "INVALID_DATE" },
        },
        { status: 400 },
      );
    }

    // limit: 최대 200
    const rawLimit = parseInt(searchParams.get("limit") || "50", 10);
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 200);

    const projectId = searchParams.get("projectId") ?? undefined;

    const sourceTypeParam = searchParams.get("sourceType");
    const sourceTypes = sourceTypeParam
      ? sourceTypeParam.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    const documents = await prisma.document.findMany({
      where: {
        collectedAt: { gte: since },
        ...(projectId ? { projectId } : {}),
        ...(sourceTypes && sourceTypes.length > 0
          ? { sourceType: { in: sourceTypes as SourceType[] } }
          : {}),
      },
      orderBy: { collectedAt: "desc" },
      take: limit,
      select: {
        id: true,
        title: true,
        url: true,
        sourceType: true,
        projectId: true,
        collectionId: true,
        tags: true,
        summary: true,
        publishedAt: true,
        collectedAt: true,
        metadata: true,
        source: {
          select: { id: true, name: true, type: true },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        documents,
        since: since.toISOString(),
        count: documents.length,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        {
          success: false,
          error: { message: error.message, code: "AUTH_ERROR" },
        },
        { status: error.statusCode },
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: { message, code: "FETCH_FAILED" } },
      { status: 500 },
    );
  }
}
