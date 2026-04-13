#!/usr/bin/env python3
"""
SB/PPT Vision 인제스트 — 건건이 파이프라인
Vision 완료 → 즉시 임베딩 → 즉시 Qdrant 적재
중단 후 재실행 시 이미 적재된 슬라이드는 스킵

사용법:
  python3 scripts/sb-vision-ingest.py <pptx_path> [--workers 2] [--project komca]
"""

import argparse, base64, json, os, sys, time, hashlib
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

OLLAMA = os.getenv("OLLAMA_URL", "http://localhost:11434")
QDRANT = os.getenv("QDRANT_URL", "http://192.168.0.67:12333")
COLLECTION = os.getenv("QDRANT_COLLECTION", "rag_production")
ZAI_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions"
ZAI_KEY = "6cfa5d0dcf134a6a8e82bb1ff4209148.eN8PTh2q0o48VaYH"  # Coding Plan Pro

VISION_PROMPT = """이 슬라이드를 분석해주세요.
1. 화면 ID와 제목
2. 주요 UI 컴포넌트 (버튼, 입력폼, 테이블, 그리드 등)
3. 테이블이 있으면 마크다운 테이블로 변환
4. 비즈니스 규칙이나 조건 분기가 있으면 설명
5. 메뉴 경로 (예: 징수분배>공통>음악사용자료>큐시트)

빈 슬라이드거나 내용이 거의 없으면 EMPTY_SLIDE라고만 답해주세요."""


def vision_analyze(png_path: str) -> str:
    with open(png_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    for attempt in range(3):
        try:
            r = requests.post(ZAI_URL, headers={
                "Authorization": f"Bearer {ZAI_KEY}",
                "Content-Type": "application/json",
            }, json={
                "model": "glm-4.6v",
                "messages": [{"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    {"type": "text", "text": VISION_PROMPT},
                ]}],
                "max_tokens": 4000,
            }, timeout=180)
            d = r.json()
            if "choices" in d:
                msg = d["choices"][0]["message"]
                text = msg.get("content", "").strip()
                if not text:
                    text = msg.get("reasoning_content", "").strip()
                return text
            err = d.get("error", {}).get("message", "")[:30]
            if "Authentication" in err:
                return ""  # 인증 실패는 재시도 무의미
            return ""
        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
            continue
    return ""


def embed_single(text: str) -> list[float]:
    r = requests.post(f"{OLLAMA}/api/embed",
                      json={"model": "bge-m3", "input": [text]}, timeout=60)
    return r.json()["embeddings"][0]


def text_to_sparse(text: str) -> dict:
    words = text.lower().split()
    tf = {}
    for w in words:
        if len(w) < 2: continue
        h = 0
        for c in w:
            h = ((h << 5) - h + ord(c)) & 0x7FFFFFFF
        tf[h % 1000000] = tf.get(h % 1000000, 0) + 1
    mx = max(tf.values()) if tf else 1
    return {"indices": list(tf.keys()), "values": [v / mx for v in tf.values()]}


def get_existing_slides(file_hash: str) -> dict[int, tuple[int, str]]:
    """이미 Qdrant에 적재된 슬라이드 정보 {슬라이드번호: (point_id, png_hash)}"""
    try:
        r = requests.post(f"{QDRANT}/collections/{COLLECTION}/points/scroll", json={
            "filter": {"must": [{"key": "chunk_id", "match": {"text": f"sb-{file_hash}"}}]},
            "limit": 1000,
            "with_payload": ["chunk_id", "png_hash"],
        }, timeout=30)
        existing: dict[int, tuple[int, str]] = {}
        for p in r.json().get("result", {}).get("points", []):
            cid = p.get("payload", {}).get("chunk_id", "")
            png_hash = p.get("payload", {}).get("png_hash", "")
            point_id = p.get("id", 0)
            parts = cid.rsplit("-s", 1)
            if len(parts) == 2:
                try: existing[int(parts[1])] = (point_id, png_hash)
                except: pass
        return existing
    except:
        return {}


def get_next_id() -> int:
    info = requests.get(f"{QDRANT}/collections/{COLLECTION}").json()
    return info["result"]["points_count"] + 1


def compute_png_hash(png_path: str) -> str:
    """PNG 파일의 SHA-256 해시 (앞 16자)"""
    h = hashlib.sha256()
    with open(png_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def ingest_one(slide_num: int, content: str, title: str, file_hash: str,
               project: str, point_id: int, png_hash: str = ""):
    """단일 슬라이드 임베딩 + Qdrant 적재 (upsert)"""
    emb = embed_single(content)
    sparse = text_to_sparse(content)
    requests.put(f"{QDRANT}/collections/{COLLECTION}/points", json={
        "points": [{
            "id": point_id,
            "vector": {"dense": emb, "text": sparse},
            "payload": {
                "chunk_id": f"sb-{file_hash}-s{slide_num}",
                "content": content,
                "title": title,
                "source_type": "DOCUMENT",
                "project_id": project,
                "png_hash": png_hash,
            },
        }],
    }, timeout=30)


def main():
    parser = argparse.ArgumentParser(description="SB/PPT Vision 인제스트 (파이프라인)")
    parser.add_argument("pptx", help="PPT/PPTX 파일 경로")
    parser.add_argument("--workers", type=int, default=2, help="Vision 병렬 워커 수")
    parser.add_argument("--project", default="komca", help="프로젝트 ID")
    parser.add_argument("--dpi", type=int, default=150, help="PNG 해상도")
    args = parser.parse_args()

    if not os.path.exists(args.pptx):
        print(f"파일 없음: {args.pptx}")
        sys.exit(1)

    doc_name = Path(args.pptx).stem[:50]
    file_hash = hashlib.md5(args.pptx.encode()).hexdigest()[:8]
    work_dir = f"/tmp/sb-ingest-{file_hash}"
    png_dir = f"{work_dir}/png"
    os.makedirs(png_dir, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  SB Vision 파이프라인 ({args.workers}워커)")
    print(f"  {Path(args.pptx).name}")
    print(f"{'='*60}\n")

    # 1) PPT → PDF
    pdf_files = [f for f in os.listdir(work_dir) if f.endswith(".pdf")]
    if not pdf_files:
        print("[1/3] PPT → PDF...")
        os.system(f'/Applications/LibreOffice.app/Contents/MacOS/soffice --headless --convert-to pdf --outdir "{work_dir}" "{args.pptx}" 2>/dev/null')
        pdf_files = [f for f in os.listdir(work_dir) if f.endswith(".pdf")]
    pdf_path = f"{work_dir}/{pdf_files[0]}" if pdf_files else None
    if not pdf_path:
        print("PDF 변환 실패!")
        sys.exit(1)

    # 2) PDF → PNG
    existing_pngs = [f for f in os.listdir(png_dir) if f.endswith(".png")]
    if len(existing_pngs) < 10:
        from pdf2image import convert_from_path
        print("[2/3] PDF → PNG...")
        images = convert_from_path(pdf_path, dpi=args.dpi)
        for i, img in enumerate(images):
            img.save(f"{png_dir}/slide_{i+1:04d}.png", "PNG")
        print(f"  → {len(images)}장")
    else:
        print(f"[2/3] PNG {len(existing_pngs)}장 존재, 스킵")

    slides = sorted([f for f in os.listdir(png_dir) if f.endswith(".png")])
    total = len(slides)

    # 중복/변경 체크 (PNG 해시 비교)
    existing = get_existing_slides(file_hash)
    new_slides = []      # 신규
    changed_slides = []  # 변경됨
    unchanged = 0

    for f in slides:
        num = int(f.replace("slide_", "").replace(".png", ""))
        current_hash = compute_png_hash(f"{png_dir}/{f}")
        if num not in existing:
            new_slides.append((f, num, current_hash))
        else:
            _, old_hash = existing[num]
            if old_hash and old_hash == current_hash:
                unchanged += 1
            else:
                changed_slides.append((f, num, current_hash, existing[num][0]))

    remaining = new_slides + changed_slides
    print(f"\n[3/3] Vision → 임베딩 → Qdrant (건건이 파이프라인)")
    print(f"  전체: {total}장, 변경없음: {unchanged}장, 변경: {len(changed_slides)}장, 신규: {len(new_slides)}장\n")

    if not remaining:
        print("  모두 적재 완료!")
        return

    t0 = time.time()
    success = 0
    updated = 0
    skipped = 0
    next_id = get_next_id()
    import threading
    lock = threading.Lock()

    def process_and_ingest(item):
        nonlocal success, updated, skipped, next_id
        if len(item) == 3:
            fname, num, png_hash = item
            reuse_id = None
        else:
            fname, num, png_hash, reuse_id = item

        text = vision_analyze(f"{png_dir}/{fname}")

        if not text or "EMPTY_SLIDE" in text or len(text) < 30:
            with lock:
                skipped += 1
            return

        title = f"[SB] {doc_name} Slide {num}"
        content = f"[SB Slide {num} | 문서:{doc_name} | 유형:화면설계서]\n{text}"

        try:
            with lock:
                if reuse_id is not None:
                    my_id = reuse_id
                else:
                    my_id = next_id
                    next_id += 1
            ingest_one(num, content, title, file_hash, args.project, my_id, png_hash)
            with lock:
                if reuse_id is not None:
                    updated += 1
                else:
                    success += 1
        except Exception:
            pass

    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(process_and_ingest, item): item for item in remaining}
        for future in as_completed(futures):
            done += 1
            elapsed = time.time() - t0
            rate = done / (elapsed / 60) if elapsed > 0 else 0
            eta = (len(remaining) - done) / rate if rate > 0 else 0
            sys.stdout.write(f"\r  [{done}/{len(remaining)}] {success}건 신규, {updated}건 갱신, {skipped}건 스킵 | {rate:.1f}장/분 | ETA {eta:.0f}분")
            sys.stdout.flush()

    print(f"\n\n{'='*60}")
    print(f"  완료! {success}건 신규, {updated}건 갱신, {skipped}건 스킵")
    print(f"  총 {unchanged + success + updated}/{total}장 ({(time.time()-t0)/60:.1f}분)")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
