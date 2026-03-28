#!/usr/bin/env npx tsx
/**
 * rag_production → rag_production_v2 마이그레이션
 * - dense, text(sparse) 벡터는 그대로 복사
 * - alias 벡터를 새로 생성 (bge-m3 임베딩)
 *   - 별칭 매칭: "코드명 한국어별칭" 임베딩
 *   - 비매칭: title 임베딩
 */

import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_URL = process.env.QDRANT_URL || 'http://192.168.0.67:12333';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.0.81:11434';
const SRC_COLLECTION = 'rag_production';
const DST_COLLECTION = 'rag_production_v2';
const EMBED_BATCH = 20;

const qdrant = new QdrantClient({ url: QDRANT_URL });

// ── aliases.ts 사전 인라인 (tsx 경로 문제 회피) ──
const ALIASES: Record<string, string[]> = {
  'SP_DISTR_BRDCSTWO': ['방송2차 분배', '방송이차 분배'],
  'SP_DISTR_BRDCS': ['방송 분배', '방송1차 분배'],
  'SP_DISTR_ABR_NOLOG': ['외국입금 무자료 분배'],
  'SP_DISTR_ABR': ['외국입금 분배'],
  'SP_TRANS_TDIS_DISTR': ['매체별 분배 순서', '분배 이행', '년도별 분배'],
  'SP_DISTR_HIS_UPDATE': ['분배 이력 업데이트'],
  'SP_DISTR_RESULT_SIMUL': ['분배 결과 시뮬레이션'],
  'SP_DISTR_CATV': ['CATV 분배', '케이블TV 분배'],
  'SP_DISTR_ETC': ['기타 분배'],
  'SP_DISTR_TRNS': ['전송 분배'],
  'SP_DISTR_PRFM': ['연주 분배', '공연 분배'],
  'SP_DISTR_DEFER': ['이연 분배', '분배 유보'],
  'GET_TMEM_DAEPYO_ADDR': ['회원 대표 주소 조회'],
  'GET_TMEM_NM': ['회원명 조회'],
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
  'TLEV_NON_MNG_TUNE': ['미관리곡'],
  'TOPU_CERT_HIST': ['증명서 이력'],
  'TENV_SVC_CD': ['서비스코드'],
  'TENV_AVE_CLASS_CD': ['매체중분류코드'],
  'BILL_SEND': ['세금계산서 전송', '거래명세서'],
  'dist/imports/excel': ['분배 데이터 엑셀 수입', '분배 엑셀 일괄 업로드'],
  'dist/apprv-registers': ['승인대장'],
  'levy/contr/bscon/apprv': ['거래처 계약 승인'],
  'comm/logs/ydn/online-use-tune': ['온라인 사용곡'],
  'comm/logs/ydn/supply-include-song': ['공급곡목'],
  'dist/foreign-dist-data': ['외국분배자료', '외국 분배 데이터'],
  'levy/clr/mng': ['징수 정산 관리'],
  'levy/rpdc/reward': ['보상금지급'],
  'SchdQsheetRelsUpdateRequest': ['큐시트 해제 요청', '편성표 해제'],
  'RpdcRewardDemdPaymentExcel': ['보상금지급 엑셀 다운로드'],
  'BrdcsDistrRecMapper': ['방송 분배 기록 Mapper'],
  'DistParamBuilder': ['분배 파라미터 빌더'],
  'MIG_BRDCS111': ['방송 데이터 마이그레이션'],
  'NetflixRe': ['넷플릭스 큐시트'],
  'AbrNologDistProcessRequest': ['외국입금 무자료 분배 요청'],
  'BillController': ['징수 청구 컨트롤러'],
  'QsheetControllerTest': ['큐시트 컨트롤러 테스트'],
};

function getAliasText(title: string, content: string): string {
  const matched: { code: string; aliases: string[] }[] = [];
  for (const [pattern, aliases] of Object.entries(ALIASES)) {
    if (title.includes(pattern) || content.includes(pattern)) {
      matched.push({ code: pattern, aliases });
    }
  }
  if (matched.length === 0) return title || 'unknown';
  const codes = matched.map((m) => m.code).join(' ');
  const aliasTexts = [...new Set(matched.flatMap((m) => m.aliases))].join(' ');
  return `${codes} ${aliasTexts}`;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
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

async function main() {
  let migrated = 0;
  let aliasMatched = 0;
  let offset: string | number | undefined = undefined;
  const startTime = Date.now();

  // v2 현재 포인트 수 확인 (이어하기 지원)
  const v2Info = await qdrant.getCollection(DST_COLLECTION);
  const existingCount = v2Info.points_count ?? 0;
  if (existingCount > 0) {
    console.log(`\n⚠️ ${DST_COLLECTION}에 이미 ${existingCount}건 존재. 이어서 진행합니다.\n`);
  }

  const srcInfo = await qdrant.getCollection(SRC_COLLECTION);
  const totalPoints = srcInfo.points_count ?? 0;

  console.log(`\n=== 마이그레이션 ${SRC_COLLECTION} → ${DST_COLLECTION} ===`);
  console.log(`총 ${totalPoints.toLocaleString()}건, alias 임베딩 포함\n`);

  while (true) {
    const result = await qdrant.scroll(SRC_COLLECTION, {
      limit: 50,
      with_payload: true,
      with_vector: true,
      ...(offset ? { offset } : {}),
    });

    if (result.points.length === 0) break;

    // alias 임베딩 텍스트 생성
    const aliasTexts = result.points.map((p) => {
      const payload = (p.payload ?? {}) as Record<string, unknown>;
      const title = (payload.title as string) || '';
      const content = (payload.content as string) || '';
      const text = getAliasText(title, content);
      if (text !== (title || 'unknown')) aliasMatched++;
      return text;
    });

    // alias 벡터 배치 임베딩
    const aliasEmbeddings = await embedBatch(aliasTexts);

    // v2에 upsert (dense + sparse + alias)
    const points = result.points.map((p, i) => {
      const vectors = p.vector as Record<string, unknown>;
      return {
        id: p.id,
        vector: {
          dense: vectors.dense as number[],
          text: vectors.text as { indices: number[]; values: number[] },
          alias: aliasEmbeddings[i],
        },
        payload: p.payload ?? {},
      };
    });

    await qdrant.upsert(DST_COLLECTION, { points, wait: false });

    migrated += points.length;
    offset = result.next_page_offset as string | number | undefined;

    if (migrated % 500 === 0 || !offset) {
      const elapsed = (Date.now() - startTime) / 60_000;
      const rate = migrated / elapsed;
      const remaining = (totalPoints - migrated) / rate;
      console.log(
        `  ${migrated.toLocaleString()}/${totalPoints.toLocaleString()} (${((migrated / totalPoints) * 100).toFixed(1)}%) | ` +
        `alias 매칭: ${aliasMatched}건 | ${elapsed.toFixed(1)}분 경과 | 남은: ~${remaining.toFixed(0)}분`
      );
    }

    if (!offset) break;
  }

  const elapsed = (Date.now() - startTime) / 60_000;
  console.log(`\n=== 완료: ${migrated.toLocaleString()}건 마이그레이션 (${elapsed.toFixed(1)}분) ===`);
  console.log(`  alias 매칭: ${aliasMatched}건 (${((aliasMatched / migrated) * 100).toFixed(1)}%)`);
}

main().catch(console.error);
