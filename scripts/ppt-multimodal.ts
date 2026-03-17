#!/usr/bin/env npx tsx
/**
 * PPT 멀티모달 수집: 슬라이드별 이미지 → Gemini Vision 분석 → rag-collector 저장
 *
 * 사용법:
 *   npx tsx scripts/ppt-multimodal.ts /tmp/komca-ppt/slides/ "징수분배 SB v0.11"
 */

import { readFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
const VISION_MODEL = 'gemini-3.1-flash-lite-preview';
const RAG_BASE_URL = process.env.RAG_COLLECTOR_URL || 'http://192.168.0.67:11009';
const RAG_API_KEY = process.env.RAG_API_KEY || '';
const CONCURRENCY = 2;
const DELAY = 1000;

async function analyzeSlide(imagePath: string, slideNum: number, docName: string): Promise<string | null> {
  const imageBytes = readFileSync(imagePath);
  const base64 = imageBytes.toString('base64');
  const ext = extname(imagePath).slice(1).toLowerCase();
  const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;

  for (let retry = 0; retry < 3; retry++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: mimeType, data: base64 } },
                { text: `이 슬라이드(${docName}, ${slideNum}번째)를 분석해주세요.

다음 정보를 추출해주세요:
1. 슬라이드 제목
2. 주요 내용 (텍스트, 목록, 설명)
3. 테이블이 있으면 마크다운 테이블로 변환
4. 다이어그램/플로우차트가 있으면 구조를 텍스트로 설명
5. UI 화면설계서면 레이아웃, 컴포넌트, 인터랙션 설명

빈 슬라이드거나 내용이 거의 없으면 "EMPTY_SLIDE"라고만 답해주세요.
한국어로 답변하되, 기술 용어는 원문 유지.` },
              ],
            }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
          }),
        },
      );

      if (res.status === 429) {
        console.warn(`  [429] slide ${slideNum} rate limit, ${3 + retry * 2}초 대기...`);
        await new Promise((r) => setTimeout(r, (3 + retry * 2) * 1000));
        continue;
      }

      if (!res.ok) {
        console.warn(`  [${res.status}] slide ${slideNum} 에러`);
        return null;
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text || text.includes('EMPTY_SLIDE')) return null;
      return `## 슬라이드 ${slideNum}\n\n${text}`;
    } catch (e) {
      if (retry === 2) console.warn(`  slide ${slideNum} 실패:`, e);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null;
}

async function ingestToRag(title: string, content: string, slideNum: number, docName: string, tags: string[]): Promise<boolean> {
  try {
    const res = await fetch(`${RAG_BASE_URL}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(RAG_API_KEY ? { Authorization: `ApiKey ${RAG_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        title: `${docName} - 슬라이드 ${slideNum}`,
        content,
        tags: [...tags, 'presentation', 'slide', `slide-${slideNum}`],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const slidesDir = process.argv[2];
  const docName = process.argv[3] || 'PPT Document';

  if (!slidesDir) {
    console.error('사용법: npx tsx scripts/ppt-multimodal.ts <슬라이드폴더> <문서이름>');
    process.exit(1);
  }
  if (!GEMINI_API_KEY) {
    console.error('GOOGLE_API_KEY 환경변수를 설정하세요.');
    process.exit(1);
  }

  const files = readdirSync(slidesDir)
    .filter((f) => f.endsWith('.png') || f.endsWith('.jpg'))
    .sort();

  console.log(`=== PPT 멀티모달 수집 ===`);
  console.log(`문서: ${docName}`);
  console.log(`슬라이드: ${files.length}장`);
  console.log('');

  let analyzed = 0;
  let empty = 0;
  let saved = 0;
  let failed = 0;
  const startTime = Date.now();
  const tags = ['komca', '징수분배', 'storyboard'];

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (file, j) => {
      const slideNum = i + j + 1;
      const imagePath = join(slidesDir, file);

      const content = await analyzeSlide(imagePath, slideNum, docName);
      if (!content) {
        empty++;
        return;
      }
      analyzed++;

      const ok = await ingestToRag(`${docName} - 슬라이드 ${slideNum}`, content, slideNum, docName, tags);
      if (ok) saved++;
      else failed++;
    });

    await Promise.all(promises);
    await new Promise((r) => setTimeout(r, DELAY));

    if ((i + CONCURRENCY) % 20 === 0 || i + CONCURRENCY >= files.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`[${elapsed}s] ${Math.min(i + CONCURRENCY, files.length)}/${files.length} (분석:${analyzed} 빈슬라이드:${empty} 저장:${saved} 실패:${failed})`);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log('');
  console.log(`=== 완료 (${totalTime}초) ===`);
  console.log(`분석: ${analyzed}장 | 빈슬라이드: ${empty}장 | 저장: ${saved}장 | 실패: ${failed}장`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
