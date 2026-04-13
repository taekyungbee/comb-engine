#!/usr/bin/env npx tsx
/**
 * 한국어 별칭 포함 재인덱싱
 * - 매칭 대상 포인트만 선별
 * - content 앞에 한국어 별칭 헤더 추가
 * - dense vector (bge-m3) + sparse vector 모두 재생성
 * - Qdrant payload + vector 업데이트
 */

import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_URL = process.env.QDRANT_URL || 'http://192.168.0.67:12333';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.0.81:11434';
const COLLECTION = process.env.QDRANT_COLLECTION || 'rag_production';
const BATCH_SIZE = 10; // 임베딩 배치 크기

const qdrant = new QdrantClient({ url: QDRANT_URL });

// 한국어 별칭 매핑 — title/content에 코드명이 있으면 별칭을 헤더로 추가
const KOREAN_ALIASES: Record<string, string[]> = {
  'SP_DISTR_BRDCSTWO': ['방송2차 분배', '방송이차 분배'],
  'SP_DISTR_BRDCS': ['방송 분배', '방송1차 분배'],
  'SP_DISTR_ABR_NOLOG': ['외국입금 무자료 분배'],
  'SP_TRANS_TDIS_DISTR': ['매체별 분배 순서', '분배 이행', '년도별 분배'],
  'SP_DISTR_HIS_UPDATE': ['분배 이력 업데이트'],
  'SP_DISTR_RESULT_SIMUL': ['분배 결과 시뮬레이션'],
  'SP_DISTR_CATV': ['CATV 분배', '케이블TV 분배'],
  'SP_DISTR_ETC': ['기타 분배'],
  'SP_DISTR_TRNS': ['전송 분배'],
  'SP_DISTR_PRFM': ['연주 분배', '공연 분배'],
  'TDIS_ABR_ERR_RETURN': ['외국입금 분배 오류 반환'],
  'TDIS_BRDCSTWORPDCPGM': ['방송2차 분배 프로그램'],
  'TDIS_BRDCSTWORPDCREC': ['방송2차 분배 기록'],
  'TENV_SVCCD': ['서비스코드'],
  'TENV_AVECLASSCD': ['매체중분류코드'],
  'TLEV_YETMNGTUNE': ['미관리곡'],
  'TLEV_CONTR_INFO': ['거래처 계약정보'],
  'TOPU_CERTIFICATE_HISTORY': ['증명서 이력'],
  'TOPU_CWR_ACK': ['CWR 확인', 'Common Works Registration'],
  'TOPU_AVI_RAW': ['AVI 원본 데이터'],
  'BILL_TRANS': ['세금계산서 전송', '거래명세서'],
  'TBRA_SMS_FORMAT': ['SMS 포맷', 'SMS 양식', '지부별 SMS'],
  'TDIS_COMPENSATION_LOG': ['분배 보상 로그'],
  'GET_TMEM_DAEPYO_ADDR': ['회원 대표 주소 조회'],
  'dist/imports/excel': ['분배 데이터 엑셀 수입', '분배 엑셀 일괄 업로드'],
  'dist/apprv-registers': ['승인대장'],
  'levy/contr/bscon/apprv': ['거래처 계약 승인'],
  'comm/logs/ydn/online-use-tune': ['온라인 사용곡'],
  'comm/logs/ydn/supply-include-song': ['공급곡목'],
  'dist/foreign-dist-data': ['외국분배자료', '외국 분배 데이터'],
  'SchdQsheetRelsUpdateRequest': ['큐시트 해제 요청', '편성표 해제'],
  'RpdcRewardDemdPaymentExcel': ['보상금지급 엑셀 다운로드'],
  'BrdcsDistrRecMapper': ['방송 분배 기록 Mapper'],
  'DistParamBuilder': ['분배 파라미터 빌더'],
  'MIG_BRDCS111': ['방송 데이터 마이그레이션'],
  'NetflixRe': ['넷플릭스 큐시트'],
};

// 원본 qdrant.ts와 동일한 sparse 생성
function textToSparse(text: string): { indices: number[]; values: number[] } {
  const words = text.toLowerCase().split(/[\s.,;:!?()[\]{}"'/\\]+/);
  const tf = new Map<number, number>();
  for (const w of words) {
    if (w.length < 2) continue;
    let hash = 0;
    for (let i = 0; i < w.length; i++) {
      hash = ((hash << 5) - hash + w.charCodeAt(i)) & 0x7fffffff;
    }
    tf.set(hash % 1000000, (tf.get(hash % 1000000) || 0) + 1);
  }
  const maxTf = Math.max(...tf.values(), 1);
  const indices = [...tf.keys()];
  const values = indices.map((i) => (tf.get(i) || 0) / maxTf);
  return { indices, values };
}

// bge-m3 임베딩 배치
async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const r = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'bge-m3', input: batch }),
    });
    const d = (await r.json()) as { embeddings: number[][] };
    results.push(...d.embeddings);
  }
  return results;
}

function getAliases(title: string, content: string): string[] {
  const matched: string[] = [];
  for (const [pattern, aliases] of Object.entries(KOREAN_ALIASES)) {
    if (title.includes(pattern) || content.includes(pattern)) {
      matched.push(...aliases);
    }
  }
  return [...new Set(matched)];
}

async function main() {
  let updated = 0;
  let scanned = 0;
  let offset: string | number | undefined = undefined;

  // 먼저 대상 포인트를 수집
  console.log(`\n=== 재인덱싱 대상 수집 중... ===\n`);

  const targets: Array<{ id: string | number; content: string; title: string; aliases: string[] }> = [];

  while (true) {
    const result = await qdrant.scroll(COLLECTION, {
      limit: 100,
      with_payload: { include: ['title', 'content'] },
      ...(offset ? { offset } : {}),
    });

    if (result.points.length === 0) break;

    for (const point of result.points) {
      scanned++;
      const payload = (point.payload ?? {}) as Record<string, unknown>;
      const title = (payload.title as string) || '';
      const content = (payload.content as string) || '';

      const aliases = getAliases(title, content);
      if (aliases.length > 0) {
        targets.push({ id: point.id, content, title, aliases });
      }
    }

    offset = result.next_page_offset as string | number | undefined;
    if (!offset) break;

    if (scanned % 10000 === 0) {
      console.log(`  스캔: ${scanned}건, 대상: ${targets.length}건`);
    }
  }

  console.log(`\n스캔 완료: ${scanned}건 중 ${targets.length}건 대상\n`);
  console.log(`=== 재임베딩 시작 ===\n`);

  // 배치로 재임베딩
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);

    // 별칭 헤더를 content 앞에 추가
    const enrichedContents = batch.map((t) => {
      const header = `[별칭: ${t.aliases.join(', ')}]\n`;
      return header + t.content;
    });

    // dense 임베딩 재생성
    const embeddings = await embedBatch(enrichedContents);

    // Qdrant 업데이트 (content + dense + sparse)
    const points = batch.map((t, j) => ({
      id: t.id,
      vector: {
        dense: embeddings[j],
        text: textToSparse(enrichedContents[j]),
      },
      payload: {
        content: enrichedContents[j], // 별칭 포함된 content
      },
    }));

    // payload 업데이트
    for (const point of points) {
      await qdrant.overwritePayload(COLLECTION, {
        points: [point.id],
        payload: point.payload,
      });
    }

    // vector 업데이트
    await qdrant.updateVectors(COLLECTION, {
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
      })),
    });

    updated += batch.length;
    if (updated % 50 === 0 || i + BATCH_SIZE >= targets.length) {
      const pct = ((updated / targets.length) * 100).toFixed(1);
      console.log(`  재인덱싱: ${updated}/${targets.length} (${pct}%)`);
    }
  }

  console.log(`\n=== 완료: ${updated}건 재인덱싱 ===`);
}

main().catch(console.error);
