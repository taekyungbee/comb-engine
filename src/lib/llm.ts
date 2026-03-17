/**
 * LLM 요약/번역 유틸리티
 * - Collector에서 수집한 콘텐츠를 한국어로 번역/요약
 * - Gemini API (OpenAI 호환)
 */

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

interface TranslatedContent {
  titleKo: string;
  summary: string;
  contentKo: string;
  category: string;
  importance: number;
}

function stripThinking(text: string): string {
  let result = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const divider = result.indexOf('---');
  if (divider > 0 && divider < result.length * 0.5) {
    result = result.slice(divider + 3).trim();
  }
  return result;
}

async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  jsonMode = false,
): Promise<string | null> {
  if (!GEMINI_API_KEY) throw new Error('GOOGLE_API_KEY 또는 GEMINI_API_KEY가 설정되지 않았습니다.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const body: Record<string, unknown> = {
      model: GEMINI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 8192,
      temperature: 0.3,
    };

    if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GEMINI_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`[LLM] Gemini error: ${res.status} ${await res.text()}`);
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    return content ? stripThinking(content) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractJsonFromResponse(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

const TRANSLATE_SYSTEM = `당신은 기술 콘텐츠를 분석·번역하는 봇입니다. 반드시 유효한 JSON만 출력하세요.`;

function buildTranslatePrompt(title: string, content: string, source: string): string {
  const truncated = content.length > 2000 ? content.slice(0, 2000) + '...' : content;

  return `아래 글을 분석하고 한국어로 번역해줘.

출처: ${source}
제목: ${title}
내용: ${truncated}

JSON 형식으로 응답:
{
  "titleKo": "한국어 제목. 원제가 영어면 '한국어 번역 (원제)' 형식",
  "summary": "핵심 내용을 불릿포인트로 2~4줄 요약. '- 요약1\\n- 요약2' 형식",
  "contentKo": "본문 전체를 자연스러운 한국어로 번역. 이미 한국어면 그대로",
  "category": "아래 8개 중 하나: 기술, 트렌드, 적용 아이디어, 커뮤니티, 교리/철학, 신규 기능, 사건사고, 사회/경제",
  "importance": 3
}

중요도: 1=관심없음, 2=참고, 3=보통, 4=중요, 5=핵심`;
}

export async function translateAndSummarize(
  title: string,
  content: string,
  source: string,
): Promise<TranslatedContent | null> {
  const prompt = buildTranslatePrompt(title, content, source);
  const raw = await callGemini(TRANSLATE_SYSTEM, prompt, true);
  if (!raw) return null;

  const parsed = extractJsonFromResponse(raw) as TranslatedContent | null;
  if (!parsed?.titleKo || !parsed?.contentKo) return null;

  return {
    titleKo: parsed.titleKo,
    summary: parsed.summary || '',
    contentKo: parsed.contentKo,
    category: parsed.category || '기술',
    importance: Math.min(Math.max(parsed.importance || 3, 1), 5),
  };
}

/**
 * 콘텐츠 요약 (V1 요약 생성)
 * 수집된 원본(V0) → AI 요약(V1) → 이 요약으로 임베딩
 */
export async function summarizeContent(
  title: string,
  content: string,
  sourceType?: string,
): Promise<string | null> {
  const truncated = content.length > 4000 ? content.slice(0, 4000) + '...' : content;

  const systemPrompt = `당신은 기술 문서를 요약하는 전문가입니다. 핵심 내용만 정확하고 간결하게 요약하세요.`;
  const userPrompt = `다음 문서를 요약해주세요.

제목: ${title}
소스 타입: ${sourceType || 'unknown'}
내용:
${truncated}

요약 규칙:
- 핵심 내용을 3~5줄로 요약
- 기술 용어는 원문 유지
- 불릿포인트 형식 ("- 요약1\\n- 요약2")
- 코드 파일이면 주요 기능/클래스/패턴을 설명`;

  return callGemini(systemPrompt, userPrompt);
}

/**
 * 배치 요약 (여러 문서)
 */
export async function summarizeBatch(
  items: Array<{ title: string; content: string; sourceType?: string }>,
  batchSize = 3,
): Promise<Map<number, string>> {
  const results = new Map<number, string>();

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const promises = batch.map(async (item, idx) => {
      const globalIdx = i + idx;
      const result = await summarizeContent(item.title, item.content, item.sourceType);
      if (result) results.set(globalIdx, result);
    });
    await Promise.all(promises);
  }

  return results;
}

export async function translateBatch(
  items: Array<{ title: string; content: string; source: string }>,
  batchSize = 3,
): Promise<Map<number, TranslatedContent>> {
  const results = new Map<number, TranslatedContent>();

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const promises = batch.map(async (item, idx) => {
      const globalIdx = i + idx;
      const result = await translateAndSummarize(item.title, item.content, item.source);
      if (result) results.set(globalIdx, result);
    });
    await Promise.all(promises);
  }

  return results;
}
