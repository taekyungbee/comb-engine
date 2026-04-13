import { NextRequest, NextResponse } from "next/server";
import { searchSimilar } from "@/services/search.service";
import { authenticateRequest, AuthError } from "@/lib/api-auth";
import { rateLimitMiddleware } from "@/middleware/rate-limit";

const rateLimit = rateLimitMiddleware({ limit: 1000, windowMs: 60000 });

async function handler(request: NextRequest) {
  try {
    // API Key 인증 필요
    const user = await authenticateRequest(request);
    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: { message: "Authentication required", code: "UNAUTHORIZED" },
        },
        { status: 401 },
      );
    }

    const body = await request.json();
    const {
      query,
      limit,
      threshold,
      sourceTypes,
      tags,
      projectId,
      collectionIds,
    } = body;

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: { message: "query is required", code: "VALIDATION_ERROR" },
        },
        { status: 400 },
      );
    }

    const results = await searchSimilar(query, {
      limit,
      threshold,
      sourceTypes,
      tags,
      projectId,
      collectionIds,
    });
    return NextResponse.json({
      success: true,
      data: { results, count: results.length },
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
      { success: false, error: { message, code: "SEARCH_FAILED" } },
      { status: 500 },
    );
  }
}

export const POST = rateLimit(handler);
