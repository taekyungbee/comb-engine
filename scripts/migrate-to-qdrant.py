#!/usr/bin/env python3
"""
pgvector → Qdrant 전체 마이그레이션
1. 프로덕션 컬렉션 생성
2. 임베딩 완료 청크: 헤더 강화 + Qdrant 적재
3. 미임베딩 청크: bge-m3 임베딩 + 헤더 강화 + Qdrant 적재
배치 512, Qdrant 직접 적재 (pgvector INSERT 병목 없음)
"""
import psycopg2
import requests
import json
import time
import re
import sys

DB = 'postgresql://rag:2yjl5gGGnSKqzSh5ruNSAb0UuRuME2Vh@192.168.0.67:5433/rag_collector'
QDRANT = 'http://192.168.0.67:12333'
OLLAMA = 'http://localhost:11434'
COLLECTION = 'rag_production'
EMBED_BATCH = 256
UPSERT_BATCH = 100

# ── 메타데이터 헤더 강화 ──
PROC_MAPPING = {
    'SP_DISTR_ABR_NOLOG': '외국입금 무자료 분배',
    'SP_DISTR_ABR_NOLOG_BAK': '외국입금 무자료 분배 백업',
    'SP_DISTR_ABR_NOLOG_SIMUL': '외국입금 무자료 분배 시뮬레이션',
    'SP_DISTR_BRDCSTWO': '방송2차 분배',
    'SP_DISTR_BRDCSTWO_NOLOG': '방송2차 무자료 분배',
    'SP_DISTR_BRDCS': '방송 분배',
    'SP_DISTR_CATV': '케이블TV 분배',
    'SP_DISTR_CATV_NOLOG': '케이블TV 무자료 분배',
    'SP_DISTR_TRMS': '전송 분배',
    'SP_DISTR_ETC': '기타매체 분배',
    'SP_DISTR_PERF': '연주 분배',
    'SP_DISTR_TLEV_OTT': 'OTT 징수 분배',
    'SP_TRANS_TDIS_DISTR': '년도별 분배내역 이행 (방송/CATV/기타/전송/연주)',
}

def enrich_header(content, title, source_type):
    # Oracle 프로시저 - 목적 없으면 추가
    if source_type in ('ORACLE_SCHEMA', 'API_INGEST') and content.startswith('[SP_'):
        if '목적:' not in content[:200]:
            m = re.match(r'\[(\w+)', content)
            if m:
                proc = m.group(1)
                purpose = PROC_MAPPING.get(proc, '')
                if not purpose:
                    parts = []
                    upper = proc.upper()
                    if 'ABR' in upper: parts.append('외국입금')
                    if 'NOLOG' in upper: parts.append('무자료')
                    if 'BRDCS' in upper: parts.append('방송')
                    if 'CATV' in upper: parts.append('케이블TV')
                    if 'TRMS' in upper: parts.append('전송')
                    if 'PERF' in upper: parts.append('연주')
                    if 'ETC' in upper: parts.append('기타매체')
                    if 'SIMUL' in upper: parts.append('시뮬레이션')
                    if 'SOGB' in upper: parts.append('소급')
                    if upper.startswith('SP_DISTR'): parts.append('분배')
                    elif upper.startswith('SP_TRANS'): parts.append('이행')
                    purpose = ' '.join(parts)
                if purpose:
                    content = content.replace(']', f' | 목적:{purpose}]', 1)

    # Oracle 테이블
    if source_type == 'ORACLE_SCHEMA' and 'CREATE TABLE' in content and not content.startswith('[테이블'):
        m = re.search(r'Table:\s*(\S+)', content)
        tbl = m.group(1) if m else title
        cols = re.findall(r'^\s+(\w+)\s+(?:VARCHAR2|NUMBER|CHAR|DATE|CLOB|BLOB|RAW|TIMESTAMP)', content, re.M)
        col_list = ', '.join(cols[:8])
        content = f'[테이블: {tbl} | 주요컬럼: {col_list}]\n{content}'

    # Java
    if source_type == 'JAVA_SOURCE' and not content.startswith('[Java'):
        cls = title.rsplit('.', 1)[-1] if '.' in title else title
        pkg = title.rsplit('.', 1)[0] if '.' in title else ''
        annots = re.findall(r'@(Service|Controller|Mapper|Repository)', content)
        doc = re.search(r'/\*\*\s*\n?\s*\*\s*(.+?)(?:\n|\*/)', content)
        header = f'[Java 클래스: {cls} | 패키지: {pkg}'
        if annots: header += f' | 유형: {",".join(set(annots))}'
        if doc: header += f' | 설명: {doc.group(1).strip()[:60]}'
        asis = re.search(r'ASIS:\s*(\S+)', content)
        if asis: header += f' | AS-IS: {asis.group(1)}'
        header += ']'
        content = f'{header}\n{content}'

    # BUSINESS_RULE
    if '[BUSINESS_RULE]' in content and not content.startswith('[JIRA'):
        m = re.search(r'KOMCA-(\d+)', content)
        ticket = f'KOMCA-{m.group(1)}' if m else ''
        dm = re.search(r'"domain":"([^"]+)"', content)
        domain = dm.group(1) if dm else ''
        st = re.search(r'"status":"([^"]+)"', content)
        status = st.group(1) if st else ''
        tm = re.search(r'\]\s*(.+?)(?:\s*\{|$)', content[:200])
        func = tm.group(1).strip()[:60] if tm else ''
        content = f'[JIRA: {ticket} | 도메인: {domain} | 상태: {status} | 기능: {func}]\n{content}'

    # 컬럼매핑
    if '컬럼매핑' in title and not content.startswith('[컬럼매핑'):
        am = re.search(r'AS-IS:\s*(\S+)', content)
        tm = re.search(r'TO-BE:\s*(\S+)', content)
        cm = re.search(r'코멘트\((?:AS-IS|TO-BE)\):\s*(.+)', content)
        content = f'[컬럼매핑: {am.group(1) if am else ""} → {tm.group(1) if tm else ""} | 용도: {cm.group(1).strip()[:60] if cm else ""}]\n{content}'

    # 프론트엔드
    if 'front' in title.lower() and not content.startswith('[프론트'):
        parts = title.split('/')
        fp = [p for p in parts if p not in ('src', 'network', 'apis', 'types', 'komca-collectdist-front')]
        content = f'[프론트엔드: {"/".join(fp[-3:])}]\n{content}'

    return content

# ── Sparse vector ──
vocab = {}
def text_to_sparse(text):
    words = text.lower().split()
    tf = {}
    for w in words:
        w = w.strip('.,;:!?()[]{}"\'/\\')
        if len(w) < 2: continue
        if w not in vocab: vocab[w] = len(vocab)
        tf[vocab[w]] = tf.get(vocab[w], 0) + 1
    mx = max(tf.values()) if tf else 1
    return {"indices": list(tf.keys()), "values": [tf[i]/mx for i in tf.keys()]}

# ── 임베딩 ──
def embed_batch(texts):
    r = requests.post(f'{OLLAMA}/api/embed', json={'model': 'bge-m3', 'input': texts}, timeout=300)
    return r.json()['embeddings']

# ── Main ──
def main():
    conn = psycopg2.connect(DB)
    cur = conn.cursor()

    # 1. 컬렉션 생성
    print("=== Qdrant 프로덕션 컬렉션 생성 ===")
    requests.delete(f'{QDRANT}/collections/{COLLECTION}')
    r = requests.put(f'{QDRANT}/collections/{COLLECTION}', json={
        "vectors": {"dense": {"size": 1024, "distance": "Cosine"}},
        "sparse_vectors": {"text": {}},
        "optimizers_config": {"indexing_threshold": 50000},
        "quantization_config": {"scalar": {"type": "int8", "quantile": 0.99, "always_ram": True}}
    })
    print(f"컬렉션: {r.json().get('status')}")

    # 2. 통계
    cur.execute("""
        SELECT COUNT(*)::int as total,
               COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END)::int as embedded
        FROM document_chunks WHERE LENGTH(content) > 50
    """)
    total, embedded = cur.fetchone()
    need_embed = total - embedded
    print(f"\n총 청크: {total}, 임베딩 완료: {embedded}, 미임베딩: {need_embed}")

    # 3. Phase 1: 임베딩 완료 청크 적재
    print(f"\n=== Phase 1: 임베딩 완료 {embedded}개 적재 ===")
    PAGE = 5000
    offset = 0
    point_id = 0
    t0 = time.time()

    while True:
        cur.execute("""
            SELECT dc.id, dc.content, d.title, d.source_type, dc.embedding::text
            FROM document_chunks dc
            JOIN documents d ON dc.document_id = d.id
            WHERE dc.embedding IS NOT NULL AND LENGTH(dc.content) > 50
            ORDER BY dc.id
            OFFSET %s LIMIT %s
        """, (offset, PAGE))
        rows = cur.fetchall()
        if not rows:
            break

        points = []
        for chunk_id, content, title, src_type, emb_str in rows:
            vec = [float(x) for x in emb_str.strip('[]').split(',')]
            enriched = enrich_header(content, title, src_type)
            sp = text_to_sparse(enriched)
            points.append({
                "id": point_id,
                "vector": {"dense": vec, "text": sp},
                "payload": {
                    "chunk_id": str(chunk_id),
                    "content": enriched,
                    "title": title,
                    "source_type": src_type
                }
            })
            point_id += 1

        # Qdrant upsert (배치)
        for i in range(0, len(points), UPSERT_BATCH):
            batch = points[i:i+UPSERT_BATCH]
            r = requests.put(f'{QDRANT}/collections/{COLLECTION}/points', json={"points": batch})
            if r.status_code != 200:
                print(f"  Error: {r.text[:200]}")

        offset += PAGE
        rate = point_id / (time.time() - t0)
        print(f"  {point_id}/{embedded} ({rate:.0f}/s)")

    phase1_time = time.time() - t0
    print(f"Phase 1 완료: {point_id}개, {phase1_time/60:.1f}분")

    # 4. Phase 2: 미임베딩 청크 → 임베딩 + 적재
    print(f"\n=== Phase 2: 미임베딩 {need_embed}개 임베딩 + 적재 ===")
    offset = 0
    phase2_count = 0
    t0 = time.time()

    while True:
        cur.execute("""
            SELECT dc.id, dc.content, d.title, d.source_type
            FROM document_chunks dc
            JOIN documents d ON dc.document_id = d.id
            WHERE dc.embedding IS NULL AND LENGTH(dc.content) > 50
            ORDER BY dc.id
            LIMIT %s
        """, (EMBED_BATCH,))
        rows = cur.fetchall()
        if not rows:
            break

        # 헤더 강화
        enriched_texts = []
        meta = []
        for chunk_id, content, title, src_type in rows:
            enriched = enrich_header(content, title, src_type)
            enriched_texts.append(enriched[:8000])
            meta.append((str(chunk_id), enriched, title, src_type))

        # bge-m3 임베딩
        try:
            embeddings = embed_batch(enriched_texts)
        except Exception as e:
            print(f"  임베딩 에러: {e}, 스킵")
            continue

        # Qdrant 적재
        points = []
        for (chunk_id, enriched, title, src_type), emb in zip(meta, embeddings):
            sp = text_to_sparse(enriched)
            points.append({
                "id": point_id,
                "vector": {"dense": emb, "text": sp},
                "payload": {
                    "chunk_id": chunk_id,
                    "content": enriched,
                    "title": title,
                    "source_type": src_type
                }
            })
            point_id += 1

        for i in range(0, len(points), UPSERT_BATCH):
            batch = points[i:i+UPSERT_BATCH]
            requests.put(f'{QDRANT}/collections/{COLLECTION}/points', json={"points": batch})

        phase2_count += len(rows)
        elapsed = time.time() - t0
        rate = phase2_count / elapsed if elapsed > 0 else 0
        eta = (need_embed - phase2_count) / rate / 60 if rate > 0 else 0
        print(f"  {phase2_count}/{need_embed} ({rate:.0f}/s, ETA {eta:.0f}분)")

    phase2_time = time.time() - t0
    print(f"Phase 2 완료: {phase2_count}개, {phase2_time/60:.1f}분")

    # 5. 최종 통계
    r = requests.get(f'{QDRANT}/collections/{COLLECTION}')
    info = r.json()['result']
    total_time = phase1_time + phase2_time
    print(f"\n{'='*60}")
    print(f"마이그레이션 완료")
    print(f"  Qdrant 포인트: {info['points_count']}")
    print(f"  인덱스 상태: {info['status']}")
    print(f"  총 소요: {total_time/60:.1f}분")
    print(f"  Sparse vocab: {len(vocab)}")
    print(f"{'='*60}")

    conn.close()

if __name__ == '__main__':
    main()
