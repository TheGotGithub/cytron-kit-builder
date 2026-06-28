"""
Cytron Product Search API
รัน: python3 search_api/app.py

Endpoints:
  GET  /health          → สถานะ API + model
  GET  /search?q=...    → ค้นหาสินค้า
  POST /reindex         → re-embed ทุกสินค้า (admin)
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # ให้ app อื่น (Line Bot, n8n, frontend) เรียกได้

# ── โหลด model ตอน startup (ไม่ใช่ต่อ request) ───────────────
print('[startup] loading RAG search module...')
t0 = time.time()
from rag_search import search as _search, reindex as _reindex
from rag_search.vector_searcher import ensure_ready
ensure_ready()
_startup_ms = round((time.time() - t0) * 1000)
print(f'[startup] ready in {_startup_ms}ms')


# ── /health ───────────────────────────────────────────────────
@app.get('/health')
def health():
    from cytron_db import get_db
    conn = get_db()
    total    = conn.execute('SELECT COUNT(*) FROM products').fetchone()[0]
    embedded = conn.execute(
        'SELECT COUNT(*) FROM products WHERE embedding IS NOT NULL'
    ).fetchone()[0]
    conn.close()
    return jsonify({
        'status':        'ok',
        'model':         'paraphrase-multilingual-mpnet-base-v2',
        'products_total':    total,
        'products_embedded': embedded,
        'startup_ms':    _startup_ms,
    })


# ── /search ───────────────────────────────────────────────────
@app.get('/search')
def search():
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify({'error': 'missing query param ?q='}), 400

    try:
        limit = int(request.args.get('limit', 5))
        limit = max(1, min(limit, 20))  # clamp 1–20
    except ValueError:
        return jsonify({'error': 'limit must be integer'}), 400

    t0      = time.time()
    results = _search(q, limit=limit)
    took_ms = round((time.time() - t0) * 1000)

    return jsonify({
        'query':   q,
        'limit':   limit,
        'count':   len(results),
        'took_ms': took_ms,
        'results': results,
    })


# ── /reindex ──────────────────────────────────────────────────
@app.post('/reindex')
def reindex():
    secret = request.headers.get('X-Admin-Key', '')
    if secret != app.config.get('ADMIN_KEY', 'cytron-admin'):
        return jsonify({'error': 'unauthorized'}), 401

    t0     = time.time()
    result = _reindex(force=True)
    took_s = round(time.time() - t0, 1)
    return jsonify({**result, 'took_s': took_s})


# ── run ───────────────────────────────────────────────────────
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=False)
