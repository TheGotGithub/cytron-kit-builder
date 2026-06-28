"""
Hybrid Search: alpha * vector_score + (1-alpha) * keyword_score

alpha=0.7 (default) → 70% semantic, 30% exact match
ปรับ alpha ตาม use case:
  - สูง (0.8+) → เน้น semantic, ข้ามภาษา
  - ต่ำ (0.5)  → เน้น product code / exact match
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from rag_search.vector_searcher import (
    _expand, _name_match, _load_matrix, _status,
    SCORE_FOUND, SCORE_SUGGEST,
)
from rag_search.searcher import keyword_score
from rag_search.embedder import embed_one
from cytron_db import get_db

import re
import numpy as np

DEFAULT_ALPHA = 0.7


def search(query: str, limit: int = 5, alpha: float = DEFAULT_ALPHA) -> list[dict]:
    """
    Hybrid search: vector + keyword combined.
    Returns list[dict]: {id, name, price, product_url, image_url,
                         score, vscore, kscore, status}
    """
    expanded     = _expand(query)
    was_expanded = expanded.lower().strip() != query.lower().strip()
    query_words  = re.findall(r'\w+', expanded.lower())

    conn = get_db()
    raw_rows = conn.execute(
        'SELECT id, name, price, product_url, image_url, description, embedding '
        'FROM products WHERE embedding IS NOT NULL'
    ).fetchall()
    conn.close()

    from rag_search.embedder import blob_to_vec, VECTOR_DIM
    valid_rows, valid_vecs = [], []
    for r in raw_rows:
        vec = blob_to_vec(r['embedding'])
        if vec.shape[0] == VECTOR_DIM:
            valid_rows.append(r)
            valid_vecs.append(vec)

    if not valid_rows:
        return []

    matrix     = np.stack(valid_vecs)
    query_vec  = embed_one(expanded)
    vec_scores = matrix @ query_vec

    results = []
    for i, r in enumerate(valid_rows):
        vscore = float(vec_scores[i])
        kscore = keyword_score(query, f"{r['name']} {r['description']}")
        hscore = alpha * vscore + (1 - alpha) * kscore
        results.append({
            'id':          r['id'],
            'name':        r['name'],
            'price':       r['price'],
            'product_url': r['product_url'],
            'image_url':   r['image_url'],
            'score':       round(hscore, 3),
            'vscore':      round(vscore, 3),
            'kscore':      round(kscore, 3),
            'status':      _status(hscore),
            '_nm':         _name_match(query_words, r['name']),
        })

    if was_expanded:
        results.sort(key=lambda r: (r['_nm'], r['score']), reverse=True)
    else:
        results.sort(key=lambda r: r['score'], reverse=True)

    for r in results:
        del r['_nm']

    # deduplicate: URL มี pattern /c-{category}/p-{slug} — ใช้ slug เป็น key
    # สินค้าเดียวกันใน 3 category จะมี slug เดียวกัน → ขึ้นแค่อันแรก (score สูงสุด)
    seen, unique = set(), []
    for r in results:
        url = r['product_url'] or ''
        slug = url.split('/p-')[-1] if '/p-' in url else (r['name'].lower())
        if slug not in seen:
            seen.add(slug)
            unique.append(r)
        if len(unique) == limit:
            break

    return unique


def format_result(items: list[dict]) -> str:
    lines = []
    for item in items:
        tag = {'found': '✅', 'suggest': '⚠️', 'not_found': '❓'}.get(item['status'], '')
        lines.append(
            f"{tag} [{item['score']:.3f}] {item['name']}\n"
            f"   vector={item['vscore']:.3f}  keyword={item['kscore']:.3f}"
            f"  {item['price']} | {item['product_url']}"
        )
    return '\n'.join(lines) if lines else '❓ ไม่พบสินค้า'
