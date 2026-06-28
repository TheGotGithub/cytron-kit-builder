"""
Vector search using cosine similarity against stored embeddings.
"""
import re
import sys
import numpy as np
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from cytron_db import get_db
from rag_search.embedder import embed_one, blob_to_vec, populate_embeddings, VECTOR_DIM
from rag_search.indexer  import populate_descriptions

SCORE_FOUND   = 0.60
SCORE_SUGGEST = 0.40

# ── Query expansion ───────────────────────────────────────────
# map คำย่อ / typo ที่ engineer ใช้ → ชื่อเต็มที่ model รู้จัก
_EXPANSIONS: dict[str, str] = {
    'pi5':        'Raspberry Pi 5 Single Board Computer',
    'pi 5':       'Raspberry Pi 5 Single Board Computer',
    'rpi5':       'Raspberry Pi 5 Single Board Computer',
    'rpi 5':      'Raspberry Pi 5 Single Board Computer',
    'pi4':        'Official Raspberry Pi 4 Model B',
    'pi 4':       'Official Raspberry Pi 4 Model B',
    'rpi4':       'Official Raspberry Pi 4 Model B',
    'rpi 4':      'Official Raspberry Pi 4 Model B',
    'pi4b':       'Official Raspberry Pi 4 Model B Model B',
    'pi 4b':      'Official Raspberry Pi 4 Model B Model B',
    'pi3':        'Raspberry Pi 3',
    'pi 3':       'Raspberry Pi 3',
    'rpi3':       'Raspberry Pi 3',
    'rpi 3':      'Raspberry Pi 3',
    'pizero':     'Raspberry Pi Zero',
    'pi zero':    'Raspberry Pi Zero',
    'pi0':        'Raspberry Pi Zero',
    'rpi0':       'Raspberry Pi Zero',
    'pi zero 2w': 'Raspberry Pi Zero 2 W',
    'pi zero2w':  'Raspberry Pi Zero 2 W',
    'cm4':        'Raspberry Pi Compute Module 4',
    'cm5':        'Raspberry Pi Compute Module 5',
}

def _expand(query: str) -> str:
    return _EXPANSIONS.get(query.lower().strip(), query)


def _name_match(query_words: list[str], name: str) -> float:
    """
    สัดส่วน query words ที่ match ใน product name (0.0–1.0)
    - ตัวเลข ("5", "4") → ต้อง exact token (ป้องกัน "5" match "5th")
    - ตัวอักษร ("esp", "raspberry") → substring match (ให้ "esp" match "esp32")
    """
    if not query_words:
        return 0.0
    name_tokens = set(re.findall(r'\w+', name.lower()))
    hits = 0
    for w in query_words:
        if w.isdigit():
            if w in name_tokens:          # exact: "5" ≠ "5th"
                hits += 1
        elif len(w) >= 3:
            if any(w in tok for tok in name_tokens):   # substring: "esp" ∈ "esp32"
                hits += 1
        else:
            if w in name_tokens:
                hits += 1
    return hits / len(query_words)


def _load_matrix(conn) -> tuple[list, np.ndarray]:
    """Load all products with embeddings → (rows, matrix N×768)"""
    rows = conn.execute(
        'SELECT id, name, price, product_url, image_url, embedding '
        'FROM products WHERE embedding IS NOT NULL'
    ).fetchall()

    # กรองออก blob ที่ dim ไม่ตรง (เผื่อมี embedding เก่าจาก model อื่น)
    valid_rows, valid_vecs = [], []
    for r in rows:
        vec = blob_to_vec(r['embedding'])
        if vec.shape[0] == VECTOR_DIM:
            valid_rows.append(r)
            valid_vecs.append(vec)

    if not valid_vecs:
        return [], np.empty((0, VECTOR_DIM), dtype=np.float32)

    return valid_rows, np.stack(valid_vecs)


def search(query: str, limit: int = 5) -> list[dict]:
    """
    Embed query → cosine similarity vs all products → top-k.
    Returns list[dict]: {id, name, price, product_url, image_url, score, status}

    Pipeline:
      1. expand query (Pi5 → Raspberry Pi 5)
      2. vector search → pool = limit × 4 candidates
      3. re-rank pool: ให้ priority กับสินค้าที่ query words อยู่ใน name
      4. return top-limit
    """
    expanded     = _expand(query)
    was_expanded = expanded.lower().strip() != query.lower().strip()
    query_words  = re.findall(r'\w+', expanded.lower())

    conn = get_db()
    count = conn.execute(
        'SELECT COUNT(*) FROM products WHERE embedding IS NOT NULL'
    ).fetchone()[0]
    if count == 0:
        conn.close()
        raise RuntimeError('ยังไม่มี embeddings — run: python3 -m rag_search.embedder')

    rows, matrix = _load_matrix(conn)
    conn.close()

    if not rows:
        raise RuntimeError(
            f'embeddings มีแต่ dim ไม่ตรง (ต้องการ {VECTOR_DIM}) '
            f'— re-index ด้วย: python3 -m rag_search.embedder'
        )

    query_vec = embed_one(expanded)
    scores    = matrix @ query_vec

    # เก็บ pool กว้างขึ้นก่อน re-rank
    pool_size = max(limit * 4, 20)
    top_idx   = np.argsort(scores)[::-1][:pool_size]

    candidates = [
        {
            'id':          rows[i]['id'],
            'name':        rows[i]['name'],
            'price':       rows[i]['price'],
            'product_url': rows[i]['product_url'],
            'image_url':   rows[i]['image_url'],
            'score':       round(float(scores[i]), 3),
            'status':      _status(float(scores[i])),
            '_nm':         _name_match(query_words, rows[i]['name']),
        }
        for i in top_idx
    ]

    # re-rank เฉพาะตอน query ถูก expand (เช่น Pi5 → Raspberry Pi 5)
    # query ปกติใช้ pure vector score ไม่ re-rank (ป้องกัน false boost)
    if was_expanded:
        candidates.sort(key=lambda r: (r['_nm'], r['score']), reverse=True)

    for c in candidates:
        del c['_nm']

    # deduplicate: URL มี pattern /c-{category}/p-{slug} — ใช้ slug เป็น key
    seen, unique = set(), []
    for c in candidates:
        url = c['product_url'] or ''
        slug = url.split('/p-')[-1] if '/p-' in url else c['name'].lower()
        if slug not in seen:
            seen.add(slug)
            unique.append(c)
        if len(unique) == limit:
            break

    return unique


def _status(score: float) -> str:
    if score >= SCORE_FOUND:   return 'found'
    if score >= SCORE_SUGGEST: return 'suggest'
    return 'not_found'


def format_result(items: list[dict]) -> str:
    lines = []
    for item in items:
        tag = {'found': '✅', 'suggest': '⚠️', 'not_found': '❓'}.get(item['status'], '')
        lines.append(
            f"{tag} [{item['score']:.3f}] {item['name']}\n"
            f"   {item['price']} | {item['product_url']}"
        )
    return '\n'.join(lines) if lines else '❓ ไม่พบสินค้า'


def ensure_ready():
    """ตรวจและ populate descriptions + embeddings ถ้ายังไม่มี"""
    conn = get_db()
    empty_desc = conn.execute(
        "SELECT COUNT(*) FROM products WHERE description = ''"
    ).fetchone()[0]
    empty_emb = conn.execute(
        'SELECT COUNT(*) FROM products WHERE embedding IS NULL'
    ).fetchone()[0]

    # ตรวจ dim — นับ blob ที่ขนาดไม่ตรง (768 × 4 bytes = 3072)
    wrong_dim = conn.execute(
        f'SELECT COUNT(*) FROM products '
        f'WHERE embedding IS NOT NULL AND LENGTH(embedding) != {VECTOR_DIM * 4}'
    ).fetchone()[0]
    conn.close()

    if empty_desc > 100:
        from rag_search.parser import PRODUCT_LINK_PATH
        if PRODUCT_LINK_PATH.exists():
            print('[ensure_ready] indexing descriptions...')
            populate_descriptions()
        else:
            print('[ensure_ready] skipping descriptions (no product_link/)')

    if empty_emb > 0 or wrong_dim > 0:
        if wrong_dim > 0:
            print(f'[ensure_ready] {wrong_dim} embeddings มี dim ผิด → re-embed ทั้งหมด')
        populate_embeddings(force=(wrong_dim > 0))
