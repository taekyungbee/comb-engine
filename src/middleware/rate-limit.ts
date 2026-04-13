import { NextRequest, NextResponse } from 'next/server';

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

const store = new Map<string, { count: number; resetAt: number }>();

type AppRouteHandler = (request: NextRequest, context: Record<string, unknown>) => Promise<NextResponse> | NextResponse;

export function rateLimitMiddleware(config: Partial<RateLimitConfig> = {}) {
  const limit = config.limit || 1000;
  const windowMs = config.windowMs || 60000;

  return (handler: AppRouteHandler) => {
    return async (request: NextRequest, context: Record<string, unknown>): Promise<NextResponse> => {
      const authHeader = request.headers.get('Authorization');

      const key = (() => {
        if (authHeader?.startsWith('ApiKey ')) {
          return authHeader.slice(7);
        }
        return request.headers.get('x-forwarded-for') || 'anonymous';
      })();

      const now = Date.now();
      let record = store.get(key);

      if (!record || record.resetAt < now) {
        record = { count: 0, resetAt: now + windowMs };
      }

      record.count += 1;
      store.set(key, record);

      const remaining = Math.max(0, limit - record.count);

      if (record.count > limit) {
        return NextResponse.json(
          {
            success: false,
            error: { message: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
          },
          {
            status: 429,
            headers: {
              'X-RateLimit-Limit': limit.toString(),
              'X-RateLimit-Remaining': remaining.toString(),
              'X-RateLimit-Reset': record.resetAt.toString(),
            },
          }
        );
      }

      const response = await handler(request, context);
      
      response.headers.set('X-RateLimit-Limit', limit.toString());
      response.headers.set('X-RateLimit-Remaining', remaining.toString());
      response.headers.set('X-RateLimit-Reset', record.resetAt.toString());
      
      return response;
    };
  };
}
