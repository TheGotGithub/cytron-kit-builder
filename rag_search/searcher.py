"""
Keyword-based product search (fallback / baseline).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from cytron_db import get_db

SCORE_FOUND   = 0.75
SCORE_SUGGEST = 0.40


def keyword_score(query: str, text: str) -> float:
    if not query or not text:
        return 0.0
    words  = query.lower().split()
    text_l = text.lower()
    hits   = sum(1 for w in words if w in text_l)
    return hits / len(words)


def search(query: str, limit: int = 5) -> list[dict]:
    conn = get_db()
    rows = conn.execute(
        'SELECT id, name, price, product_url, image_url, description FROM products'
    ).fetchall()
    conn.close()

    results = []
    for row in rows:
        score = keyword_score(query, f"{row['name']} {row['description']}")
        if score > 0:
            results.append({
                'id':          row['id'],
                'name':        row['name'],
                'price':       row['price'],
                'product_url': row['product_url'],
                'image_url':   row['image_url'],
                'score':       round(score, 3),
                'status':      _status(score),
            })

    results.sort(key=lambda x: x['score'], reverse=True)
    return results[:limit]


def _status(score: float) -> str:
    if score >= SCORE_FOUND:   return 'found'
    if score >= SCORE_SUGGEST: return 'suggest'
    return 'not_found'


def format_result(items: list[dict]) -> str:
    lines = []
    for item in items:
        tag = {'found': '✅', 'suggest': '⚠️', 'not_found': '❓'}.get(item['status'], '')
        lines.append(
            f"{tag} [{item['score']:.2f}] {item['name']}\n"
            f"   {item['price']} | {item['product_url']}"
        )
    return '\n'.join(lines) if lines else '❓ ไม่พบสินค้า'
