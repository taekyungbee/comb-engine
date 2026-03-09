/**
 * LLM 요약/번역 유틸리티
 * - Collector에서 수집한 콘텐츠를 한국어로 번역/요약
 * - LM Studio (로컬) → Gemini (폴백) 순서
 */

const LM_STUDIO_URL = process.env.LM_STUDIO_URL || 'http://192.168.0.81:1234';
const LM_STUDIO_MODEL = process.env.LM_STUDIO_MODEL || 'exaone-3.5-7.8b-instruct';
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || '';

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

async function callLmStudio(
  systemPrompt: string,
  userPrompt: string,
  jsonMode = false,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const body: Record<string, unknown> = {
      model: LM_STUDIO_MODEL,
      messages: [
        { role: 'system', content: `/no_think\n${systemPrompt}` },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 8192,
      temperature: 0.3,
    };

    if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(`${LM_STUDIO_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    return content ? stripThinking(content) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: { maxOutputTokens: 4096, temperature: 0.3 },
        }),
        signal: controller.signal,
      },
    );

    if (!res.ok) return null;

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function summarize(
  systemPrompt: string,
  userPrompt: string,
  jsonMode = false,
): Promise<string | null> {
  const result = await callLmStudio(systemPrompt, userPrompt, jsonMode);
  if (result) return result;

  console.warn('[LLM] LM Studio failed, falling back to Gemini');
  return callGemini(systemPrompt, userPrompt);
}

function extractJsonFromResponse(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    // JSON 블록 추출 시도
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
  const raw = await summarize(TRANSLATE_SYSTEM, prompt, true);
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
