/**
 * 코드명 ↔ 한국어 별�� 매핑
 *
 * 검색 시 "방송2차 분배"로 질문하면 "SP_DISTR_BRDCSTWO"를 찾을 수 있도록
 * Qdrant payload의 aliases 필드에 저장됩니다.
 *
 * 새 매핑이 필요하면 여기에 추가하세요.
 * 추가 후 기존 데이터에 반영하려면: npx tsx scripts/backfill-aliases.ts
 */

const ALIASES: Record<string, string[]> = {
  // ── Oracle 프로시저 ──
  'SP_DISTR_BRDCSTWO': ['방송2차 분배', '방송이차 분배'],
  'SP_DISTR_BRDCS': ['방송 분배', '방송1�� 분배'],
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

  // ── Oracle 함수 ──
  'GET_TMEM_DAEPYO_ADDR': ['회원 대표 주소 조회'],
  'GET_TMEM_NM': ['회원명 조회'],

  // ── Oracle 테이블 (AS-IS) ─���
  'TDIS_ABR_ERR_RETURN': ['외국입금 분배 오류 반환'],
  'TDIS_BRDCSTWORPDCPGM': ['방송2차 분배 프로그램'],
  'TDIS_BRDCSTWORPDCREC': ['방송2��� 분배 기록'],
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
  'TLEV_NON_MNG_TUNE': ['미관리곡', '예트관리곡'],
  'TOPU_CERT_HIST': ['증명서 이력'],
  'TENV_SVC_CD': ['서비스코드'],
  'TENV_AVE_CLASS_CD': ['매���중분류코드'],
  'BILL_SEND': ['세금계산서 전송', '거래명세서'],

  // ── AS-IS → TO-BE 매핑 ──
  'TLEV_YETMNGTUNE→TLEV_NON_MNG_TUNE': ['미관리곡 매핑'],
  'TOPU_CERTIFICATE_HISTORY→TOPU_CERT_HIST': ['증명서 이력 매핑'],
  'TENV_SVCCD→TENV_SVC_CD': ['서비스코드 매핑'],
  'TENV_AVECLASSCD→TENV_AVE_CLASS_CD': ['매체중분류코드 매핑'],
  'BILL_TRANS→BILL_SEND': ['세금계산서 매핑'],

  // ── API 엔드포인트 키워드 ──
  'dist/imports/excel': ['분배 데이터 엑셀 수입', '분배 엑셀 일괄 업로드'],
  'dist/apprv-registers': ['승인대장'],
  'levy/contr/bscon/apprv': ['거래처 계약 승인'],
  'comm/logs/ydn/online-use-tune': ['온라인 사용곡'],
  'comm/logs/ydn/supply-include-song': ['공급곡목'],
  'dist/foreign-dist-data': ['외국분배자료', '외국 분배 데이터'],
  'levy/clr/mng': ['징수 정산 관리'],
  'levy/rpdc/reward': ['보상금지급'],

  // ── Java DTO/Class ──
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

/**
 * title/content에서 매칭되는 한국어 별칭을 반환
 */
export function getAliases(title: string, content: string): string {
  const matched: string[] = [];

  for (const [pattern, aliases] of Object.entries(ALIASES)) {
    if (title.includes(pattern) || content.includes(pattern)) {
      matched.push(...aliases);
    }
  }

  return [...new Set(matched)].join(' ');
}

/**
 * alias 벡터용 임베딩 텍스트 생성
 * 매칭되면: "코드명1 코드명2 한국어별칭1 한국어별칭2"
 * 매칭 안 되면: title (일반 의미 검색용)
 */
export function getAliasEmbeddingText(title: string, content: string): string {
  const matched: { code: string; aliases: string[] }[] = [];

  for (const [pattern, aliasList] of Object.entries(ALIASES)) {
    if (title.includes(pattern) || content.includes(pattern)) {
      matched.push({ code: pattern, aliases: aliasList });
    }
  }

  if (matched.length === 0) return title || 'unknown';

  const codes = matched.map((m) => m.code).join(' ');
  const aliasTexts = [...new Set(matched.flatMap((m) => m.aliases))].join(' ');
  return `${codes} ${aliasTexts}`;
}

/**
 * 전체 별칭 사전 (스크립트에서 사용)
 */
export function getAliasDict(): Record<string, string[]> {
  return ALIASES;
}
