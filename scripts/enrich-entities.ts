#!/usr/bin/env npx tsx
/**
 * 엔티티 정제 파이프라인 (LAZ-355)
 *
 * 수집 후 Gemini Flash를 사용해 문서 메타데이터를 정제:
 * - 도메인 분류 (징수분배/신탁회계/저작물관리/큐시트관리/공통)
 * - 핵심 태그/키워드 추출 (5~10개)
 * - 요약 생성 (없는 경우)
 *
 * 실행:
 *   npx tsx scripts/enrich-entities.ts
 *   npx tsx scripts/enrich-entities.ts --limit 100
 *   npx tsx scripts/enrich-entities.ts --project komca
 *
 * ai-server 실행:
 *   ssh ai-server "cd ~/dev/projects/side/rag-collector && \
 *     nohup env GOOGLE_API_KEY=xxx DATABASE_URL=xxx \
 *     npx tsx scripts/enrich-entities.ts > enrich.log 2>&1 &"
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

// ──────────────────────────────────────────────
// 설정
// ──────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash-lite';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

const BATCH_SIZE = 5;        // Gemini 동시 호출 수
const CONTENT_LIMIT = 3000;  // 콘텐츠 트런케이션 (토큰 절약)

// 커맨드라인 인자 파싱
const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const projectArg = args.indexOf('--project');
const MAX_DOCS = limitArg !== -1 ? parseInt(args[limitArg + 1] || '1000', 10) : 1000;
const PROJECT_FILTER = projectArg !== -1 ? args[projectArg + 1] : undefined;

// ──────────────────────────────────────────────
// KOMCA 도메인 정의
// ──────────────────────────────────────────────

const KOMCA_DOMAINS = [
  '징수분배',
  '신탁회계',
  '저작물관리',
  '큐시트관리',
  '공통',
] as const;

type KomcaDomain = (typeof KOMCA_DOMAINS)[number];

interface EnrichResult {
  domain: KomcaDomain;
  tags: string[];
  summary: string | null;
}

// ──────────────────────────────────────────────
// Gemini 호출
// ──────────────────────────────────────────────

async function callGemini(prompt: string): Promise<string | null> {
  if (!GEMINI_API_KEY) throw new Error('GOOGLE_API_KEY가 설정되지 않았습니다.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GEMINI_API_KEY}`,
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[Gemini] HTTP ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[Gemini] 타임아웃 (60s)');
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseEnrichResult(raw: string): EnrichResult | null {
  try {
    // JSON 코드블록 제거
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned) as Partial<EnrichResult>;

    const domain = KOMCA_DOMAINS.includes(parsed.domain as KomcaDomain)
      ? (parsed.domain as KomcaDomain)
      : '공통';

    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((t): t is string => typeof t === 'string').slice(0, 10)
      : [];

    const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : null;

    return { domain, tags, summary };
  } catch {
    return null;
  }
}

function buildEnrichPrompt(
  title: string,
  content: string,
  sourceType: string,
  existingSummary: string | null,
): string {
  const truncated = content.length > CONTENT_LIMIT
    ? content.slice(0, CONTENT_LIMIT) + '...'
    : content;

  const summaryInstruction = existingSummary
    ? `요약은 이미 있으므로 null로 반환해도 됩니다.`
    : `요약이 없으므로 3~5줄의 불릿포인트 요약을 생성하세요 ("- 요약1\\n- 요약2" 형식).`;

  return `다음 KOMCA(한국음악저작권협회) 시스템 문서를 분석하고 JSON으로 응답하세요.

소스 타입: ${sourceType}
제목: ${title}
내용:
${truncated}

응답 JSON 형식:
{
  "domain": "징수분배 | 신탁회계 | 저작물관리 | 큐시트관리 | 공통",
  "tags": ["태그1", "태그2", ...],
  "summary": "요약 텍스트 또는 null"
}

지침:
- domain: 위 5개 중 하나만 선택. 불분명하면 "공통".
- tags: 핵심 한국어 키워드 5~10개. Oracle 프로시저/테이블명, Java 클래스명 등 식별자 포함.
- ${summaryInstruction}
- JSON만 출력하고 다른 텍스트는 포함하지 마세요.`;
}

// ──────────────────────────────────────────────
// 단일 문서 정제
// ──────────────────────────────────────────────

async function enrichDocument(doc: {
  id: string;
  title: string;
  content: string;
  sourceType: string;
  summary: string | null;
}): Promise<EnrichResult | null> {
  const prompt = buildEnrichPrompt(doc.title, doc.content, doc.sourceType, doc.summary);
  const raw = await callGemini(prompt);
  if (!raw) return null;
  return parseEnrichResult(raw);
}

// ──────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();

  console.log('\n=== 엔티티 정제 파이프라인 시작 ===');
  console.log(`모델: ${GEMINI_MODEL} | 배치: ${BATCH_SIZE} | 최대: ${MAX_DOCS}${PROJECT_FILTER ? ` | 프로젝트: ${PROJECT_FILTER}` : ''}\n`);

  if (!GEMINI_API_KEY) {
    console.error('[오류] GOOGLE_API_KEY가 설정되지 않았습니다.');
    process.exit(1);
  }

  // 정제 대상 문서 조회 (tags가 비어 있는 문서)
  const total = await prisma.document.count({
    where: {
      tags: { isEmpty: true },
      ...(PROJECT_FILTER ? { projectId: PROJECT_FILTER } : {}),
    },
  });

  console.log(`정제 대상: ${total}건 (처리 한도: ${MAX_DOCS}건)\n`);

  if (total === 0) {
    console.log('정제할 문서가 없습니다.');
    await prisma.$disconnect();
    return;
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const startTime = Date.now();

  // 배치 처리
  let cursor: string | undefined;

  while (processed < Math.min(total, MAX_DOCS)) {
    const remaining = Math.min(total, MAX_DOCS) - processed;
    const batchSize = Math.min(BATCH_SIZE, remaining);

    const docs = await prisma.document.findMany({
      where: {
        tags: { isEmpty: true },
        ...(PROJECT_FILTER ? { projectId: PROJECT_FILTER } : {}),
      },
      select: {
        id: true,
        title: true,
        content: true,
        sourceType: true,
        summary: true,
        metadata: true,
      },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { collectedAt: 'desc' },
    });

    if (docs.length === 0) break;

    cursor = docs[docs.length - 1].id;

    type DocRow = (typeof docs)[number];

    // 병렬 정제
    const results = await Promise.all(
      docs.map(async (doc: DocRow) => {
        const result = await enrichDocument({
          id: doc.id,
          title: doc.title,
          content: doc.content,
          sourceType: doc.sourceType,
          summary: doc.summary,
        });
        return { doc, result };
      }),
    );

    // DB 업데이트
    for (const { doc, result } of results) {
      if (!result) {
        failed++;
        console.error(`  [실패] ${doc.title.slice(0, 60)}`);
        continue;
      }

      const existingMeta = (doc.metadata ?? {}) as Record<string, unknown>;
      const newMeta = {
        ...existingMeta,
        domain: result.domain,
        enrichedAt: new Date().toISOString(),
      };

      await prisma.document.update({
        where: { id: doc.id },
        data: {
          tags: result.tags,
          ...(result.summary && !doc.summary ? { summary: result.summary } : {}),
          metadata: newMeta,
        },
      });

      succeeded++;
      console.log(
        `  [${result.domain}] ${doc.title.slice(0, 50)} | 태그: ${result.tags.slice(0, 3).join(', ')}${result.tags.length > 3 ? '...' : ''}`,
      );
    }

    processed += docs.length;

    const elapsed = (Date.now() - startTime) / 1000;
    const eta = elapsed / processed * (Math.min(total, MAX_DOCS) - processed);
    console.log(
      `\n진행: ${processed}/${Math.min(total, MAX_DOCS)} | ` +
      `성공: ${succeeded} | 실패: ${failed} | ` +
      `경과: ${elapsed.toFixed(0)}s | ETA: ${eta.toFixed(0)}s\n`,
    );
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n=== 완료: ${succeeded}건 성공, ${failed}건 실패 (${elapsed.toFixed(0)}s) ===\n`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});
