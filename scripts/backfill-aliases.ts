#!/usr/bin/env npx tsx
/**
 * 기존 Qdrant 데이터에 aliases 필드 backfill
 * - content/vector는 건드리지 않음
 * - aliases payload만 추가
 *
 * 새 별칭을 aliases.ts에 추가한 후 이 스크립트를 실행하세요.
 */

import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_URL = process.env.QDRANT_URL || 'http://192.168.0.67:12333';
const COLLECTION = process.env.QDRANT_COLLECTION || 'rag_production';
const qdrant = new QdrantClient({ url: QDRANT_URL });

// aliases.ts와 동일한 사전 — 여기서 직접 import 불가(tsx 경로 문제)하므로 인라인
// 실제 관리는 src/lib/rag/aliases.ts에서 하고, 여기는 동기화
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

function getAliases(title: string, content: string): string {
  const matched: string[] = [];
  for (const [pattern, aliases] of Object.entries(ALIASES)) {
    if (title.includes(pattern) || content.includes(pattern)) {
      matched.push(...aliases);
    }
  }
  return [...new Set(matched)].join(' ');
}

async function main() {
  let updated = 0;
  let scanned = 0;
  let offset: string | number | undefined = undefined;

  console.log(`\n=== aliases backfill (${COLLECTION}) ===`);
  console.log(`  content/vector 안 건드림, aliases payload만 추가\n`);

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
      if (!aliases) continue;

      await qdrant.overwritePayload(COLLECTION, {
        points: [point.id],
        payload: { aliases },
      });

      updated++;
      if (updated % 100 === 0) {
        console.log(`  추가: ${updated}건 (스캔: ${scanned}건)`);
      }
    }

    offset = result.next_page_offset as string | number | undefined;
    if (!offset) break;

    if (scanned % 50000 === 0) {
      console.log(`  스캔: ${scanned}건 (aliases 추가: ${updated}건)`);
    }
  }

  console.log(`\n=== 완료: ${updated}건 aliases 추가 (총 ${scanned}건 스캔) ===`);
}

main().catch(console.error);
