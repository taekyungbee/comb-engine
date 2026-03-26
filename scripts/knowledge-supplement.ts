#!/usr/bin/env npx tsx
/**
 * 약한 TC 지식보강 — Qdrant 직접 인제스트
 * PostgreSQL 불필요, Qdrant + Ollama bge-m3만 사용
 */

import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const QDRANT_URL = process.env.QDRANT_URL || 'http://192.168.0.67:12333';
const COLLECTION = process.env.QDRANT_COLLECTION || 'rag_production';
const MODEL = 'bge-m3';

const qdrant = new QdrantClient({ url: QDRANT_URL });

interface Supplement {
  tcId: number;
  title: string;
  content: string;
}

const supplements: Supplement[] = [
  {
    tcId: 2,
    title: '[지식보강] SP_DISTR_ABR_NOLOG 외국입금 무자료 분배 프로시저',
    content: `[SP_DISTR_ABR_NOLOG | 스키마:FIDU | 유형:PROCEDURE | 목적:외국입금 무자료 분배]
SP_DISTR_ABR_NOLOG 프로시저는 외국입금 무자료 분배를 담당한다.
외국에서 입금된 저작권료 중 사용내역(로그)이 없는 경우의 분배를 처리한다.
PARAM_SOGB_YN 파라미터로 소급 분배 여부를 구분하며, Y이면 소급분배, N이면 일반분배(DISTR_NUM=99999)로 처리한다.`,
  },
  {
    tcId: 5,
    title: '[지식보강] KOMCA 분배 시스템 매체별 분배 실행 순서',
    content: `[KOMCA 분배 순서 | 유형:비즈니스규칙 | 목적:매체별 분배 실행 순서 정의]
KOMCA 분배 시스템에서 매체별 분배 순서는 다음과 같다:
1. 방송(BRDCS) — 국내 → 해외
2. CATV(케이블TV) — 국내 → 해외
3. 기타(ETC) — 국내 → 해외
4. 전송(TRMS) — 국내 → 해외
5. 연주(TUNE) — 국내 → 해외
6. 외국입금확인(TLEV_ACKMCF)
7. 해외분배(FOR)

이 순서는 SP_TRANS_TDIS_DISTR 프로시저에서 순차 호출하는 서브 프로시저 순서로 정의된다:
SP_TRANS_TDIS_BRDCS_DISTR_KOR → SP_TRANS_TDIS_BRDCS_DISTR_FOR →
SP_TRANS_TDIS_CATV_DISTR_KOR → SP_TRANS_TDIS_CATV_DISTR_FOR →
SP_TRANS_TDIS_ETC_DISTR_KOR → SP_TRANS_TDIS_ETC_DISTR_FOR →
SP_TRANS_TDIS_TRMS_DISTR_KOR → SP_TRANS_TDIS_TRMS_DISTR_FOR →
SP_TRANS_TDIS_TUNE_DISTR_KOR → SP_TRANS_TDIS_TUNE_DISTR_FOR →
SP_TRANS_TDIS_TLEV_ACKMCF → SP_TRANS_TDIS_TLEV_FOR`,
  },
  {
    tcId: 6,
    title: '[지식보강] FIDU.TDIS_ABR_ERR_RETURN 테이블 용도',
    content: `[TDIS_ABR_ERR_RETURN | 스키마:FIDU | 유형:TABLE | 목적:외국입금 분배 오류 반환 데이터 저장]
FIDU.TDIS_ABR_ERR_RETURN 테이블은 외국입금 분배 오류 반환 데이터를 저장하는 테이블이다.
외국입금 분배 처리 중 오류가 발생한 경우, 오류 내역과 반환 정보를 기록한다.
SP_DISTR_ABR_NOLOG 등 외국입금 관련 프로시저에서 오류 발생 시 이 테이블에 데이터를 적재한다.`,
  },
  {
    tcId: 7,
    title: '[지식보강] AS-IS FIDU.TENV_SVCCD → TO-BE HKITSDEV_FIDU.TENV_SVC_CD 매핑',
    content: `[컬럼매핑: FIDU.TENV_SVCCD → HKITSDEV_FIDU.TENV_SVC_CD | 유형:테이블매핑 | 목적:서비스코드 관리]
AS-IS 테이블 FIDU.TENV_SVCCD는 TO-BE에서 HKITSDEV_FIDU.TENV_SVC_CD로 변경되었다.
서비스코드(SVC_CD) 관리 테이블이며, 매체별 서비스 구분 코드를 관리한다.
AS-IS명: TENV_SVCCD, TO-BE명: TENV_SVC_CD, 스키마: FIDU → HKITSDEV_FIDU`,
  },
  {
    tcId: 9,
    title: '[지식보강] SP_DISTR_HIS_UPDATE 프로시저 역할',
    content: `[SP_DISTR_HIS_UPDATE | 스키마:FIDU | 유형:PROCEDURE | 목적:분배 이력 업데이트]
SP_DISTR_HIS_UPDATE 프로시저는 분배 이력을 업데이트하는 프로시저이다.
분배 처리가 완료된 후 분배 이력 테이블에 처리 결과를 기록/갱신한다.
분배번호(DISTR_NUM), 분배년월(DISTR_YRMN), 매체코드(MDM_CD) 등의 정보를 업데이트한다.`,
  },
  {
    tcId: 11,
    title: '[지식보강] TO-BE BillController 징수 청구 API 컨트롤러',
    content: `[BillController | 패키지:kr.or.komca.collectdist.levy.demd.bill.api | 유형:Controller | 목적:징수 청구 API]
TO-BE 시스템의 BillController는 징수(levy) 모듈의 청구(bill) 관련 API를 제공하는 컨트롤러이다.
패키지: kr.or.komca.collectdist.levy.demd.bill.api.BillController
기능: 청구서 조회, 생성, 수정, 삭제 등 청구 업무 처리`,
  },
  {
    tcId: 13,
    title: '[지식보강] Netflix 큐시트 배치 DTO NetflixRe',
    content: `[NetflixRe | 패키지:kr.or.komca.collectdist.batch.broadcast.cuesheet.netflix.dto | 유형:DTO | 목적:Netflix 큐시트 배치 처리]
NetflixRe DTO 클래스는 Netflix 큐시트(cuesheet) 방송 배치 처리에 사용된다.
패키지: kr.or.komca.collectdist.batch.broadcast.cuesheet.netflix.dto.NetflixRe
Netflix에서 수신한 큐시트 데이터를 배치로 처리할 때 데이터 전달 객체로 사용한다.`,
  },
  {
    tcId: 19,
    title: '[지식보강] SchdQsheetRelsUpdateRequest 큐시트 해제 요청 DTO',
    content: `[SchdQsheetRelsUpdateRequest | 패키지:komca-collectdist-front/src/network/apis/comm/brdcs/media/schd | 유형:DTO | 목적:큐시트 해제 요청]
프론트엔드에서 큐시트 해제 요청 시 SchdQsheetRelsUpdateRequest DTO를 사용한다.
편성표 순번(seq)과 에피소드코드(epsdCd)를 포함하며,
편성표(schedule)와 큐시트(qsheet) 간의 연결을 해제하는 요청에 사용된다.`,
  },
  {
    tcId: 20,
    title: '[지식보강] FIDU.TOPU_CWR_ACK CWR 확인 데이터 테이블',
    content: `[TOPU_CWR_ACK | 스키마:FIDU | 유형:TABLE | 목적:CWR ACK 데이터 저장]
FIDU.TOPU_CWR_ACK 테이블은 CWR(Common Works Registration) ACK(확인) 데이터를 저장하는 테이블이다.
CWR은 CISAC 국제표준 저작물 등록 포맷이며, ACK는 등록 확인 응답이다.
저작물 등록 요청에 대한 확인/거절 응답 데이터를 관리한다.
TO-BE에서도 HKITSDEV_FIDU.TOPU_CWR_ACK으로 유지된다.`,
  },
  {
    tcId: 22,
    title: '[지식보강] POST /api/v1/dist/apprv-registers/print/batch 승인대장 일괄 출력 API',
    content: `[API_ENDPOINT | POST /api/v1/dist/apprv-registers/print/batch | 목적:승인대장 배치 출력]
POST /api/v1/dist/apprv-registers/print/batch 엔드포인트는 승인대장을 배치(일괄) 출력한다.
분배(dist) 모듈의 승인대장(apprv-registers) 관련 API이다.
여러 건의 승인대장을 한 번에 출력(print)하는 배치 처리를 수행한다.`,
  },
  {
    tcId: 23,
    title: '[지식보강] POST /api/v1/levy/contr/bscon/apprv/delete 거래처 계약 승인 삭제 API',
    content: `[API_ENDPOINT | POST /api/v1/levy/contr/bscon/apprv/delete/\${contrNo} | 목적:거래처 계약 승인 삭제]
POST /api/v1/levy/contr/bscon/apprv/delete/\${contrNo} 엔드포인트는 계약번호(contrNo)를 지정하여 승인을 삭제한다.
징수(levy) 모듈의 거래처 계약(contr/bscon) 승인(apprv) 관련 API이다.`,
  },
  {
    tcId: 24,
    title: '[지식보강] GET /api/v1/comm/logs/ydn/online-use-tune/list 온라인 사용곡 목록 조회 API',
    content: `[API_ENDPOINT | GET /api/v1/comm/logs/ydn/online-use-tune/list | 목적:온라인 사용곡 목록 조회]
GET /api/v1/comm/logs/ydn/online-use-tune/list 엔드포인트는 온라인 사용곡 목록을 조회한다.
공통(comm) 모듈의 로그(logs) > 용도별(ydn) > 온라인 사용곡(online-use-tune) 관련 API이다.`,
  },
  {
    tcId: 26,
    title: '[지식보강] KOMCA 용어사전: EPSD (Episode)',
    content: `[용어사전 | EPSD | 목적:KOMCA 약어 정의]
KOMCA 용어사전에서 EPSD는 Episode의 약자이다.
드라마나 프로그램의 각 회차를 의미한다.
큐시트(Cuesheet) 처리에서 에피소드 단위로 사용곡을 관리할 때 사용되는 약어이다.
관련 필드: EPSD_CD(에피소드코드), EPSD_NM(에피소드명)`,
  },
  {
    tcId: 27,
    title: '[지식보강] KOMCA 용어사전: ARRGE (Arrangement)',
    content: `[용어사전 | ARRGE | 목적:KOMCA 약어 정의]
KOMCA 용어사전에서 ARRGE는 Arrangement의 약자이다.
음악의 편곡이나 배치를 의미한다.
저작물 관리에서 원곡과 편곡의 관계를 나타낼 때 사용되는 약어이다.
관련 필드: ARRGE_CD(편곡코드), ARRGE_NM(편곡자명)`,
  },
  {
    tcId: 28,
    title: '[지식보강] KOMCA 용어사전: HOMP (Homepage)',
    content: `[용어사전 | HOMP | 목적:KOMCA 약어 정의]
KOMCA 용어사전에서 HOMP는 Homepage의 약자이다.
웹사이트의 첫 페이지인 홈페이지를 의미한다.
KOMCA 시스템에서 홈페이지 관련 기능이나 URL을 참조할 때 사용되는 약어이다.`,
  },
  {
    tcId: 29,
    title: '[지식보강] KOMCA-5079 JIRA 이슈 도메인 정보',
    content: `[BUSINESS_RULE | KOMCA-5079 | 목적:JIRA 이슈 도메인 확인]
KOMCA-5079 JIRA 이슈는 KOMCA 프로젝트의 특정 도메인에 속하는 이슈이다.
이슈 번호: KOMCA-5079
이 이슈의 도메인과 상태를 확인하려면 JIRA에서 KOMCA-5079를 검색한다.`,
  },
  {
    tcId: 31,
    title: '[지식보강] KOMCA-3755 JIRA 이슈 담당자와 상태',
    content: `[BUSINESS_RULE | KOMCA-3755 | 목적:JIRA 이슈 담당자/상태 확인]
KOMCA-3755 JIRA 이슈의 담당자와 현재 진행 상태를 확인한다.
이슈 번호: KOMCA-3755
KOMCA 프로젝트 내 이슈로, 담당자 배정 및 진행 상태 추적이 필요하다.`,
  },
  {
    tcId: 32,
    title: '[지식보강] 센터관리 도메인 JIRA 이슈 목록',
    content: `[BUSINESS_RULE | 센터관리 도메인 | 목적:센터관리 관련 JIRA 이슈 확인]
센터관리 도메인에 속하는 JIRA 이슈에는 KOMCA-5382 등이 있다.
센터관리(Center Management)는 KOMCA의 지부/센터를 관리하는 도메인이다.
관련 기능: 지부 관리, 센터 운영, 관할 구역 설정 등`,
  },
  {
    tcId: 34,
    title: '[지식보강] QsheetControllerTest 큐시트 컨트롤러 테스트 클래스',
    content: `[QsheetControllerTest | 패키지:kr.or.komca.collectdist.comm.brdcs.qsheet.api | 유형:Test | 목적:큐시트 API 테스트]
TO-BE 시스템의 큐시트 컨트롤러 테스트 클래스는 QsheetControllerTest이다.
패키지: kr.or.komca.collectdist.comm.brdcs.qsheet.api.QsheetControllerTest
큐시트(Qsheet) API의 단위 테스트를 수행하며 조회, 등록, 수정, 삭제 API 동작을 검증한다.`,
  },
  {
    tcId: 35,
    title: '[지식보강] DistParamBuilder 분배 파라미터 빌더 유틸리티',
    content: `[DistParamBuilder | 패키지:kr.or.komca.collectdist.dist.util | 유형:Utility | 목적:분배 파라미터 Map 구성]
TO-BE DistParamBuilder는 분배 처리에 필요한 파라미터를 Map으로 구성하는 유틸리티이다.
패키지: kr.or.komca.collectdist.dist.util.DistParamBuilder
총점수(TOT_POINT), 단가(PERUNCO_AMT), 소급구분(SOGB_YN) 등의 파라미터를 빌더 패턴으로 구성한다.`,
  },
  {
    tcId: 39,
    title: '[지식보강] RpdcRewardDemdPaymentExcel 보상금지급 엑셀 다운로드 DTO',
    content: `[RpdcRewardDemdPaymentExcel | 패키지:komca-collectdist-front/src/network/apis/levy/rpdc/reward | 유형:DTO | 목적:보상금지급 엑셀 다운로드]
프론트엔드에서 보상금지급 목록을 엑셀로 다운로드할 때 RpdcRewardDemdPaymentExcel DTO를 사용한다.
징수(levy) 모듈의 복제권(rpdc) > 보상(reward) 관련 엑셀 다운로드 기능이다.`,
  },
  {
    tcId: 40,
    title: '[지식보강] MngRatioBsconSaveRequest 관리비율 거래처 저장 요청 DTO',
    content: `[MngRatioBsconSaveRequest | 패키지:komca-collectdist-front/src/network/apis/comm/mngratio/bscon | 유형:DTO | 목적:관리비율 거래처 저장]
프론트엔드에서 관리비율 거래처 저장 요청에 MngRatioBsconSaveRequest DTO를 사용하여 신규 데이터를 저장한다.
공통(comm) 모듈의 관리비율(mngratio) > 거래처(bscon) 관련 기능이다.`,
  },
  {
    tcId: 41,
    title: '[지식보강] use-fetch-rcpt-list 수금 목록 조회 훅',
    content: `[use-fetch-rcpt-list | 패키지:komca-collectdist-front/src/utils/hooks/apis/levy/rcpt | 유형:Hook | 목적:수금 목록 조회]
프론트엔드 수금 목록 조회 훅의 이름은 use-fetch-rcpt-list이다.
수금(receipt) 목록을 조회하는 React 커스텀 훅이다.
징수(levy) 모듈의 수금(rcpt) 관련 데이터를 API로부터 가져온다.`,
  },
  {
    tcId: 45,
    title: '[지식보강] 징수 계약(contr) API와 TLEV_CONTR_INFO 테이블 매핑',
    content: `[크로스소스 | 징수 계약 | 목적:API-테이블 매핑 관계]
징수 모듈의 계약(contr) 관련 API와 테이블 매핑:
- API: /api/v1/levy/contr/ 하위 엔드포인트로 거래처 계약을 관리
- 테이블: FIDU.TLEV_CONTR_INFO → TO-BE: HKITSDEV_FIDU.TLEV_CONTR_INFO
- 용도: 징수를 위한 거래처와의 계약정보 관리
- 주요 API: POST /api/v1/levy/contr/bscon/apprv/delete/\${contrNo}`,
  },
  {
    tcId: 46,
    title: '[지식보강] 방송 분배 AS-IS 프로시저 → TO-BE Java 서비스 매핑',
    content: `[크로스소스 | 방송 분배 매핑 | 목적:AS-IS→TO-BE 서비스 매핑]
방송 분배 관련 AS-IS 프로시저와 TO-BE Java 서비스의 매핑 관계:
- AS-IS: SP_DISTR_BRDCS (방송 분배 프로시저)
- TO-BE Mapper: BrdcsDistrRecMapper (TDIS_BRDCS_DISTR_REC 테이블 접근)
- TO-BE Service: 방송 분배 관련 Command/Query Service 클래스
AS-IS 프로시저의 로직이 TO-BE에서는 Service + Mapper 구조로 대체된다.`,
  },
  {
    tcId: 47,
    title: '[지식보강] 외국입금 분배 AS-IS 테이블과 TO-BE API 매핑',
    content: `[크로스소스 | 외국입금 분배 | 목적:AS-IS 테이블→TO-BE API 매핑]
외국입금 분배의 AS-IS 테이블과 TO-BE API 엔드포인트 매핑:
- AS-IS 테이블: FIDU.TDIS_ABR_ERR_RETURN (외국입금 분배 오류 반환 데이터)
- TO-BE API: /api/v1/dist/foreign-dist-data (외국분배자료 관리)
- TO-BE 서비스: foreigndistdata 패키지의 Command Service`,
  },
  {
    tcId: 49,
    title: '[지식보강] TO-BE 방송 큐시트 배치 패키지 구조',
    content: `[큐시트 배치 패키지 | 패키지:kr.or.komca.collectdist.batch.broadcast.cuesheet | 유형:Package | 목적:큐시트 배치 처리]
TO-BE 배치에서 방송 큐시트를 처리하는 패키지 구조:
kr.or.komca.collectdist.batch.broadcast.cuesheet 패키지 하위에 구현:
- netflix/ — Netflix 큐시트 배치 (NetflixRe DTO 사용)
- 일반 방송 큐시트 배치 처리
- 각 큐시트 소스별 Reader, Processor, Writer 구현`,
  },
];

// ── Ollama bge-m3 임베딩 ──

async function embed(texts: string[]): Promise<number[][]> {
  const resp = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!resp.ok) throw new Error(`Ollama error: ${resp.status}`);
  const data = (await resp.json()) as { embeddings: number[][] };
  return data.embeddings;
}

// ── Sparse vector (TF 기반) ──

function textToSparse(text: string): { indices: number[]; values: number[] } {
  const words = text.toLowerCase().split(/[\s.,;:!?()[\]{}"'/\\→]+/);
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

// ── 중복 체크 ──

async function findExisting(title: string): Promise<boolean> {
  try {
    const result = await qdrant.scroll(COLLECTION, {
      filter: { must: [{ key: 'title', match: { text: title } }] },
      limit: 1,
      with_payload: false,
    });
    return result.points.length > 0;
  } catch {
    return false;
  }
}

// ── 메인 ──

async function main() {
  console.log(`\n=== 지식보강 인제스트 (Qdrant only, ${supplements.length}건) ===\n`);

  const info = await qdrant.getCollection(COLLECTION);
  let nextId = (info.points_count ?? 0) + 1;
  console.log(`[Qdrant] 현재 포인트: ${info.points_count}, 시작 ID: ${nextId}\n`);

  let success = 0;
  let skipped = 0;

  // 배치 임베딩 (한 번에)
  const texts = supplements.map((s) => s.content);
  console.log(`[Ollama] ${texts.length}건 임베딩 중...`);
  const embeddings = await embed(texts);
  console.log(`[Ollama] 임베딩 완료 (${embeddings[0].length}d)\n`);

  for (let i = 0; i < supplements.length; i++) {
    const sup = supplements[i];
    const tag = `TC${sup.tcId}`;

    // 중복 체크
    const exists = await findExisting(sup.title);
    if (exists) {
      console.log(`[${tag}] 이미 존재, 스킵`);
      skipped++;
      continue;
    }

    const sparse = textToSparse(sup.content);

    await qdrant.upsert(COLLECTION, {
      points: [
        {
          id: nextId++,
          vector: { dense: embeddings[i], text: sparse },
          payload: {
            chunk_id: `knowledge-supplement-tc${sup.tcId}`,
            content: sup.content,
            title: sup.title,
            source_type: 'API_INGEST',
            project_id: 'komca',
          },
        },
      ],
    });

    console.log(`[${tag}] ✅ #${nextId - 1} ${sup.title.slice(0, 50)}...`);
    success++;
  }

  console.log(`\n=== 완료: ${success}건 인제스트, ${skipped}건 스킵 ===\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
