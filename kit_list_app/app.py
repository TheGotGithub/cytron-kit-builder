import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))  # software/
from cytron_db import get_db, setup, DB_PATH, get_compatible, ordered_ids

import urllib.request
from flask import Flask, jsonify, render_template, request, Response

app = Flask(__name__)

if not DB_PATH.exists():
    setup()

# โหลด model ครั้งเดียวตอน startup
from rag_search.vector_searcher import ensure_ready
from rag_search.hybrid_searcher import search as _hybrid_search
ensure_ready()


# ── Catalog ───────────────────────────────────────────────────────────────────

_catalog: list | None = None


def load_catalog() -> list:
    conn = get_db()
    rows = conn.execute('''
        SELECT id, name, category, subcategory, price, product_url, image_url
        FROM products
        ORDER BY cat_order, subcat_order, prod_order, name
    ''').fetchall()
    conn.close()

    catalog  = []
    cat_idx  = {}

    for row in rows:
        cat = row['category']
        sub = row['subcategory']

        if cat not in cat_idx:
            cat_idx[cat] = {'name': cat, 'subcategories': {}, '_list': []}
            catalog.append(cat_idx[cat])

        cat_entry = cat_idx[cat]
        if sub not in cat_entry['subcategories']:
            sub_entry = {'name': sub, 'products': []}
            cat_entry['subcategories'][sub] = sub_entry
            cat_entry['_list'].append(sub_entry)

        cat_entry['subcategories'][sub]['products'].append({
            'id':          row['id'],
            'name':        row['name'],
            'price':       row['price'],
            'product_url': row['product_url'],
            'image_url':   row['image_url'],
        })

    for cat_entry in catalog:
        cat_entry['subcategories'] = cat_entry.pop('_list')

    return catalog


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/catalog')
def api_catalog():
    global _catalog
    if _catalog is None:
        _catalog = load_catalog()
    return jsonify(_catalog)


# ── Compatibility ─────────────────────────────────────────────────────────────

@app.route('/api/compatibility/<int:product_id>')
def api_get_compat(product_id):
    conn = get_db()
    result = get_compatible(conn, product_id)
    conn.close()
    return jsonify(result)


@app.route('/api/compatibility', methods=['POST'])
def api_add_compat():
    data = request.get_json(force=True)
    try:
        a, b = ordered_ids(int(data['product_id_a']), int(data['product_id_b']))
    except (KeyError, ValueError) as e:
        return jsonify({'ok': False, 'error': str(e)}), 400
    if a == b:
        return jsonify({'ok': False, 'error': 'same product'}), 400

    notes  = data.get('notes', '')
    source = data.get('source', 'manual')
    try:
        conn = get_db()
        conn.execute('''
            INSERT INTO compatibility (product_id_a, product_id_b, notes, source)
            VALUES (?, ?, ?, ?)
        ''', (a, b, notes, source))
        conn.commit()
        conn.close()
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 409


@app.route('/api/compatibility', methods=['DELETE'])
def api_del_compat():
    data = request.get_json(force=True)
    try:
        a, b = ordered_ids(int(data['product_id_a']), int(data['product_id_b']))
    except (KeyError, ValueError) as e:
        return jsonify({'ok': False, 'error': str(e)}), 400

    conn = get_db()
    conn.execute('''
        DELETE FROM compatibility WHERE product_id_a = ? AND product_id_b = ?
    ''', (a, b))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ── Search ────────────────────────────────────────────────────────────────────

@app.route('/api/proxy')
def proxy_page():
    url = request.args.get('url', '')
    if not url.startswith('https://th.cytron.io/'):
        return 'Invalid URL', 400
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        })
        with urllib.request.urlopen(req, timeout=15) as r:
            html = r.read()
        return Response(html, content_type='text/html; charset=utf-8')
    except Exception as e:
        return f'<p style="padding:20px;font-family:sans-serif;color:red">โหลดหน้าเว็บไม่ได้: {e}</p>', 502


@app.route('/api/batch-search', methods=['POST'])
def api_batch_search():
    data  = request.get_json(force=True)
    items = data.get('items', [])
    out   = []
    for q in items:
        q = q.strip()
        if not q:
            continue
        res = _hybrid_search(q, limit=1)
        if res:
            top = res[0]
            out.append({
                'query':  q,
                'status': top['status'],
                'name':   top['name'],
                'price':  top['price'],
                'url':    top['product_url'],
                'score':  top['score'],
            })
        else:
            out.append({'query': q, 'status': 'not_found', 'name': '', 'price': '', 'url': '', 'score': 0})
    return jsonify(out)


@app.route('/api/products/search')
def api_search():
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify([])
    try:
        limit = min(int(request.args.get('limit', 20)), 30)
    except ValueError:
        limit = 20
    results = _hybrid_search(q, limit=limit)
    return jsonify(results)


@app.route('/api/products/<int:id>')
def api_get_product(id):
    conn = get_db()
    row = conn.execute(
        'SELECT id, name, category, subcategory, cat_order, subcat_order, prod_order, '
        'price, product_url, image_url, description FROM products WHERE id = ?', (id,)
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({'error': 'Product not found'}), 404
    return jsonify(dict(row))


@app.route('/api/products/<int:id>', methods=['PUT'])
def api_update_product(id):
    data = request.get_json(force=True)
    fields = ['name', 'category', 'subcategory', 'cat_order', 'subcat_order', 'prod_order', 'price', 'product_url', 'image_url']
    update_data = {}
    for f in fields:
        if f in data:
            if f in ['cat_order', 'subcat_order', 'prod_order']:
                try:
                    update_data[f] = int(data[f])
                except (ValueError, TypeError):
                    return jsonify({'ok': False, 'error': f'Invalid value for {f}'}), 400
            else:
                update_data[f] = str(data[f]).strip()
    
    if not update_data:
        return jsonify({'ok': False, 'error': 'No fields to update'}), 400
        
    set_clause = ', '.join([f"{k} = ?" for k in update_data.keys()])
    values = list(update_data.values()) + [id]
    
    try:
        conn = get_db()
        result = conn.execute(f'UPDATE products SET {set_clause} WHERE id = ?', values)
        if result.rowcount == 0:
            conn.close()
            return jsonify({'ok': False, 'error': 'Product not found'}), 404
        conn.commit()
        conn.close()
        
        # Reset cache
        global _catalog
        _catalog = None
        
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 409


@app.route('/api/products', methods=['POST'])
def api_create_product():
    data = request.get_json(force=True)
    required = ['name', 'category', 'subcategory']
    for r in required:
        if r not in data or not str(data[r]).strip():
            return jsonify({'ok': False, 'error': f'Missing required field: {r}'}), 400
            
    name = str(data['name']).strip()
    category = str(data['category']).strip()
    subcategory = str(data['subcategory']).strip()
    price = str(data.get('price', '')).strip()
    product_url = str(data.get('product_url', '')).strip()
    image_url = str(data.get('image_url', '')).strip()
    
    try:
        cat_order = int(data.get('cat_order', 0))
        subcat_order = int(data.get('subcat_order', 0))
        prod_order = int(data.get('prod_order', 0))
    except (ValueError, TypeError):
        return jsonify({'ok': False, 'error': 'Invalid order parameters'}), 400
        
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('''
            INSERT INTO products (name, category, subcategory, cat_order, subcat_order, prod_order, price, product_url, image_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (name, category, subcategory, cat_order, subcat_order, prod_order, price, product_url, image_url))
        new_id = cur.lastrowid
        conn.commit()
        conn.close()
        
        # Reset cache
        global _catalog
        _catalog = None
        
        return jsonify({'ok': True, 'id': new_id})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 409


@app.route('/api/products/<int:id>', methods=['DELETE'])
def api_delete_product(id):
    try:
        conn = get_db()
        result = conn.execute('DELETE FROM products WHERE id = ?', (id,))
        if result.rowcount == 0:
            conn.close()
            return jsonify({'ok': False, 'error': 'Product not found'}), 404
        conn.commit()
        conn.close()
        
        # Reset cache
        global _catalog
        _catalog = None
        
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 409


@app.route('/products')
def products_page():
    return render_template('products.html')


if __name__ == '__main__':
    app.run(debug=True, port=5050)
