#!/usr/bin/env npx tsx
/**
 * Oracle 프로시저 청크에 목적 설명 헤더를 추가하고 임베딩을 NULL로 리셋
 * → embed-priority.ts로 재임베딩하면 검색 품질 향상
 *
 * 처리:
 * 1. [SP_XXX | 스키마:FIDU | 유형:PROCEDURE] 형식 헤더에서 목적이 없는 청크 조회
 * 2. 프로시저명 패턴에서 한국어 목적 자동 생성
 * 3. 헤더에 목적 추가 + 파라미터/테이블 메타데이터 추가
 * 4. embedding = NULL로 리셋 (재임베딩 대상)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// KOMCA 프로시저 명명 규칙 → 한국어 매핑
const NAME_PARTS: Record<string, string> = {
  // 대분류
  'SP_DISTR': '분배',
  'SP_TRANS': '이행/이관',
  'SP_TLEV': '징수',
  'SP_INSERT': '등록',
  'SP_UPDATE': '수정',
  'SP_DELETE': '삭제',
  'SP_CALC': '계산',
  'SP_MERGE': '병합',

  // 매체
  'BRDCS': '방송',
  'BRDCSTWO': '방송2차',
  'BRDCS_SEC': '방송2차',
  'CATV': '케이블TV(CATV)',
  'TRMS': '전송',
  'PERF': '연주',
  'ETC': '기타매체',
  'OTT': 'OTT',
  'WEBCASTING': '웹캐스팅',

  // 구분
  'ABR': '외국입금',
  'NOLOG': '무자료',
  'KOR': '국내곡',
  'FOR': '해외곡/외국곡',
  'SIMUL': '시뮬레이션',
  'SOGB': '소급',
  'BAK': '백업',
  'DEL': '삭제',
  'TOT': '합계/총계',
  'MEC': '방송사별',

  // 테이블/데이터
  'TDIS': '분배내역',
  'TLEV': '징수',
  'PTL': '포틀릿/부분',
  'DISTR': '분배',
  'PROD': '저작물',
  'RIGHTPRES': '권리자/회원',
  'PGM': '프로그램',
  'REC': '기록/실적',
  'LOG': '사용로그',
  'YEAR': '년도별',
  'MONTH': '월별',
  'RSLT': '결과',
  'AMT': '금액',
  'JUMSU': '점수',
};

// 특정 프로시저명 → 직접 매핑 (우선)
const DIRECT_MAPPING: Record<string, string> = {
  'SP_TRANS_TDIS_DISTR': '년도별로 분배내역을 이행한다. 방송/CATV/기타/전송/연주 매체별 국내/해외 분배와 외국입금 분배를 순차 실행',
  'SP_DISTR_ABR_NOLOG': '외국입금 무자료 분배. 외국 저작권단체로부터 입금된 로열티 중 사용로그가 없는 건에 대한 분배 처리',
  'SP_DISTR_ABR_NOLOG_BAK': '외국입금 무자료 분배 백업 프로시저',
  'SP_DISTR_ABR_NOLOG_SIMUL': '외국입금 무자료 분배 시뮬레이션',
  'SP_DISTR_BRDCSTWO': '방송2차 분배. GET_DISTR_PGM 커서로 TDIS_BRDCSTWORPDCPGM 테이블을 조회하여 방송2차 분배 처리',
  'SP_DISTR_BRDCSTWO_NOLOG': '방송2차 무자료 분배. 방송2차 매체의 사용로그 없는 건에 대한 분배 처리',
  'SP_DISTR_BRDCSTWO_NOLOG_SIMUL': '방송2차 무자료 분배 시뮬레이션',
  'SP_DISTR_BRDCS': '방송 분배. 방송매체 사용로그 기반 분배 처리',
  'SP_DISTR_BRDCS_NOLOG': '방송 무자료 분배',
  'SP_DISTR_CATV': '케이블TV(CATV) 분배',
  'SP_DISTR_CATV_NOLOG': '케이블TV(CATV) 무자료 분배',
  'SP_DISTR_CATV_NOLOG_SIMUL2': '케이블TV(CATV) 무자료 분배 시뮬레이션',
  'SP_DISTR_TRMS': '전송 분배. 디지털 음원 전송 매체에 대한 분배 처리',
  'SP_DISTR_TRMS_SIMUL2': '전송 분배 시뮬레이션',
  'SP_DISTR_TRMS_NOLOG': '전송 무자료 분배',
  'SP_DISTR_ETC': '기타매체 분배',
  'SP_DISTR_ETC_NOLOG': '기타매체 무자료 분배',
  'SP_DISTR_PERF': '연주 분배',
  'SP_DISTR_PERF_NOLOG': '연주 무자료 분배',
  'SP_DISTR_TLEV_OTT': 'OTT 징수 분배',
  'SP_DISTR_TLEV_OTT_DEL': 'OTT 징수 분배 삭제',
  'SP_DISTR_WEBCASTING': '웹캐스팅 분배',
  'SP_TRANS_TDIS_BRDCS_DISTR_KOR': '국내곡 방송 분배 이행',
  'SP_TRANS_TDIS_BRDCS_DISTR_FOR': '외국곡 방송 분배 이행',
  'SP_TRANS_TDIS_CATV_DISTR_KOR': '국내곡 케이블TV 분배 이행',
  'SP_TRANS_TDIS_CATV_DISTR_KOR_S': '국내곡 케이블TV 분배 이행 (시뮬레이션)',
  'SP_TRANS_TDIS_CATV_DISTR_KOR_2': '국내곡 케이블TV 분배 이행 (방식2)',
  'SP_TRANS_TDIS_CATV_DISTR_FOR': '외국곡 케이블TV 분배 이행',
  'SP_TRANS_TDIS_ETC_DISTR_KOR': '국내곡 기타매체 분배 이행',
  'SP_TRANS_TDIS_ETC_DISTR_FOR': '외국곡 기타매체 분배 이행',
  'SP_TRANS_TDIS_TRMS_DISTR_KOR': '국내곡 전송 분배 이행',
  'SP_TRANS_TDIS_TRMS_DISTR_FOR': '외국곡 전송 분배 이행',
  'SP_TRANS_TDIS_PERF_DISTR_KOR': '국내곡 연주 분배 이행',
  'SP_TRANS_TDIS_PERF_DISTR_FOR': '외국곡 연주 분배 이행',
  'SP_TRANS_PTL_BRDCS_DISTR_KOR': '국내곡 방송 부분 분배 이행',
  'SP_TRANS_PTL_BRDCS_DISTR_FOR': '외국곡 방송 부분 분배 이행',
  'SP_TRANS_PTL_ETC_DISTR_FOR': '외국곡 기타매체 부분 분배 이행',
};

function generatePurpose(procName: string): string {
  // 직접 매핑 우선
  if (DIRECT_MAPPING[procName]) return DIRECT_MAPPING[procName];

  // 패턴 기반 자동 생성
  const parts: string[] = [];
  const upper = procName.toUpperCase();

  // 매체 감지
  if (upper.includes('BRDCSTWO') || upper.includes('BRDCS_SEC')) parts.push('방송2차');
  else if (upper.includes('BRDCS')) parts.push('방송');
  if (upper.includes('CATV')) parts.push('케이블TV');
  if (upper.includes('TRMS')) parts.push('전송');
  if (upper.includes('PERF')) parts.push('연주');
  if (upper.includes('OTT')) parts.push('OTT');
  if (upper.includes('WEBCASTING')) parts.push('웹캐스팅');
  if (upper.includes('_ETC_')) parts.push('기타매체');

  // 구분
  if (upper.includes('ABR')) parts.push('외국입금');
  if (upper.includes('NOLOG')) parts.push('무자료');
  if (upper.includes('_KOR')) parts.push('국내곡');
  if (upper.includes('_FOR')) parts.push('외국곡');
  if (upper.includes('SIMUL')) parts.push('시뮬레이션');
  if (upper.includes('SOGB')) parts.push('소급');

  // 동작
  if (upper.startsWith('SP_DISTR')) parts.push('분배');
  else if (upper.startsWith('SP_TRANS')) parts.push('이행/이관');
  else if (upper.startsWith('SP_CALC')) parts.push('계산');

  return parts.length > 0 ? parts.join(' ') : '';
}

function extractSearchMeta(content: string): string {
  const parts: string[] = [];

  // 파라미터 추출 (PARAM_XXX IN VARCHAR2 형식)
  const paramMatches = content.match(/(?:PARAM_\w+|P_\w+)\s+(?:IN|OUT|IN\s+OUT)\s+\w+/gi);
  if (paramMatches && paramMatches.length > 0) {
    const paramNames = paramMatches.map(p => p.split(/\s+/)[0]);
    parts.push(`파라미터: ${paramNames.slice(0, 8).join(', ')}`);
  }

  // 커서명 추출
  const cursorMatches = content.match(/CURSOR\s+(\w+)\s+IS/gi);
  if (cursorMatches) {
    const cursors = cursorMatches.map(c => c.match(/CURSOR\s+(\w+)/i)?.[1]).filter(Boolean);
    parts.push(`커서: ${cursors.join(', ')}`);
  }

  // 참조 테이블 추출 (FIDU.TXXX, GIBU.TXXX 등)
  const tableMatches = content.match(/(?:FROM|JOIN|INTO|UPDATE)\s+((?:FIDU|GIBU|IFCE|KOMCACS)\.T\w+)/gi);
  if (tableMatches && tableMatches.length > 0) {
    const tables = tableMatches.map(m => m.replace(/^(?:FROM|JOIN|INTO|UPDATE)\s+/i, ''));
    const unique = [...new Set(tables)];
    parts.push(`테이블: ${unique.slice(0, 8).join(', ')}`);
  }

  // 호출 프로시저 추출
  const callMatches = content.match(/(?:FIDU|GIBU)\.SP_\w+/g);
  if (callMatches) {
    const unique = [...new Set(callMatches)];
    parts.push(`호출: ${unique.slice(0, 6).join(', ')}`);
  }

  return parts.join(' | ');
}

async function main() {
  console.log('=== Oracle 프로시저 청크 헤더 강화 ===\n');

  // 1. 목적이 없는 Oracle 프로시저 청크 조회
  const chunks = await prisma.$queryRawUnsafe<Array<{
    id: string;
    content: string;
    title: string;
  }>>(
    `SELECT dc.id, dc.content, d.title
     FROM document_chunks dc
     JOIN documents d ON dc.document_id = d.id
     WHERE d.title LIKE 'FIDU.PROCEDURE.%'
     AND dc.content LIKE '[SP_%'
     AND dc.content NOT LIKE '%목적:%'
     ORDER BY d.title`
  );

  console.log(`목적 없는 프로시저 청크: ${chunks.length}개\n`);

  let updated = 0;
  let skipped = 0;

  for (const chunk of chunks) {
    // 프로시저명 추출: [SP_XXX | 스키마:FIDU | 유형:PROCEDURE]
    const headerMatch = chunk.content.match(/^\[(\w+)\s*\|/);
    if (!headerMatch) {
      skipped++;
      continue;
    }

    const procName = headerMatch[1];
    const purpose = generatePurpose(procName);

    if (!purpose) {
      skipped++;
      continue;
    }

    // 검색 메타데이터 생성
    const searchMeta = extractSearchMeta(chunk.content);

    // 기존 헤더 교체: [SP_XXX | 스키마:FIDU | 유형:PROCEDURE] → [SP_XXX | 스키마:FIDU | 유형:PROCEDURE | 목적:XXX]
    const oldHeader = chunk.content.match(/^\[[^\]]+\]/)?.[0];
    if (!oldHeader) {
      skipped++;
      continue;
    }

    const newHeader = oldHeader.replace(/\]$/, ` | 목적:${purpose}]`);
    let newContent = chunk.content.replace(oldHeader, newHeader);

    // 검색 메타데이터 추가 (헤더 바로 다음 줄)
    if (searchMeta) {
      const headerEnd = newContent.indexOf(']') + 1;
      const after = newContent.slice(headerEnd);
      newContent = newContent.slice(0, headerEnd) + `\n[${searchMeta}]` + after;
    }

    // DB 업데이트: content 변경 + embedding NULL
    await prisma.$executeRawUnsafe(
      `UPDATE document_chunks SET content = $1, embedding = NULL WHERE id = $2::uuid`,
      newContent, chunk.id
    );

    updated++;
    if (updated % 100 === 0) {
      console.log(`  ${updated}/${chunks.length} 업데이트...`);
    }
  }

  console.log(`\n완료: ${updated}개 업데이트, ${skipped}개 스킵`);

  // 2. 추가: [SP_XXX | 스키마:FIDU | 유형:PROCEDURE] 없이 시작하는 오래된 형식 청크도 처리
  const oldFormatChunks = await prisma.$queryRawUnsafe<Array<{
    id: string;
    content: string;
    title: string;
  }>>(
    `SELECT dc.id, dc.content, d.title
     FROM document_chunks dc
     JOIN documents d ON dc.document_id = d.id
     WHERE d.title LIKE 'FIDU.PROCEDURE.SP_%'
     AND dc.content NOT LIKE '[SP_%'
     AND dc.content LIKE '%PROCEDURE%SP_%'
     AND dc.content NOT LIKE '%목적:%'
     LIMIT 5000`
  );

  console.log(`\n오래된 형식 프로시저 청크: ${oldFormatChunks.length}개`);

  let oldUpdated = 0;
  for (const chunk of oldFormatChunks) {
    // 타이틀에서 프로시저명 추출
    const titleMatch = chunk.title.match(/PROCEDURE\.(SP_\w+)/);
    if (!titleMatch) continue;

    const procName = titleMatch[1];
    const purpose = generatePurpose(procName);
    if (!purpose) continue;

    const searchMeta = extractSearchMeta(chunk.content);

    // 오래된 형식에 헤더 추가
    const header = `[${procName} | 스키마:FIDU | 유형:PROCEDURE | 목적:${purpose}]`;
    const metaLine = searchMeta ? `\n[${searchMeta}]` : '';
    const newContent = `${header}${metaLine}\n${chunk.content}`;

    await prisma.$executeRawUnsafe(
      `UPDATE document_chunks SET content = $1, embedding = NULL WHERE id = $2::uuid`,
      newContent, chunk.id
    );

    oldUpdated++;
  }

  console.log(`오래된 형식: ${oldUpdated}개 업데이트`);

  // 통계
  const stats: Array<{ cnt: number }> = await prisma.$queryRaw`
    SELECT COUNT(*)::int as cnt FROM document_chunks
    WHERE embedding IS NULL
  `;
  console.log(`\n재임베딩 대기: ${stats[0].cnt}개`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
