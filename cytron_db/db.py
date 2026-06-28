import sqlite3
import re
from pathlib import Path

DB_PATH           = Path(__file__).parent / 'cytron.db'
PRODUCT_LINK_PATH = Path(__file__).parent.parent.parent / 'product_link'


# ── Connection ────────────────────────────────────────────────────────────────

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    conn.execute('PRAGMA journal_mode = WAL')
    return conn


# ── Schema ────────────────────────────────────────────────────────────────────

def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS products (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT    NOT NULL,
            category     TEXT    NOT NULL,
            subcategory  TEXT    NOT NULL,
            cat_order    INTEGER NOT NULL DEFAULT 0,
            subcat_order INTEGER NOT NULL DEFAULT 0,
            prod_order   INTEGER NOT NULL DEFAULT 0,
            price        TEXT    NOT NULL DEFAULT '',
            product_url  TEXT    NOT NULL DEFAULT '' UNIQUE,
            image_url    TEXT    NOT NULL DEFAULT '',
            description  TEXT    NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS compatibility (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id_a INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            product_id_b INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            notes        TEXT    NOT NULL DEFAULT '',
            source       TEXT    NOT NULL DEFAULT 'manual',
            UNIQUE(product_id_a, product_id_b),
            CHECK(product_id_a < product_id_b)
        );

        CREATE INDEX IF NOT EXISTS idx_compat_a ON compatibility(product_id_a);
        CREATE INDEX IF NOT EXISTS idx_compat_b ON compatibility(product_id_b);
        CREATE INDEX IF NOT EXISTS idx_products_order
            ON products(cat_order, subcat_order, prod_order);
    ''')


# ── Indexing ──────────────────────────────────────────────────────────────────

def _parse_order(folder_name: str) -> tuple[int, str]:
    parts = folder_name.split('_', 1)
    try:
        return int(parts[0]), parts[1] if len(parts) > 1 else folder_name
    except ValueError:
        return 0, folder_name


def _parse_readme(path: Path) -> dict | None:
    try:
        content = path.read_text(encoding='utf-8')
    except Exception:
        return None

    name_match = re.search(r'^#\s+(.+)$', content, re.MULTILINE)
    if not name_match:
        return None

    price_match = re.search(r'\*\*ราคา/Price:\*\*\s*(THB\S+)', content)
    img_match   = re.search(r'!\[[^\]]*\]\(((?:https?://[^()]+(?:\([^()]*\)[^()]*)*))\)', content)
    url_match   = re.search(r'\[ดูรายละเอียด[^\]]*\]\(((?:https?://[^()]+(?:\([^()]*\)[^()]*)*))\)', content)

    return {
        'name':        name_match.group(1).strip(),
        'price':       price_match.group(1) if price_match else '',
        'image_url':   img_match.group(1)   if img_match   else '',
        'product_url': url_match.group(1)   if url_match   else '',
    }


def index_products(conn: sqlite3.Connection) -> int:
    count = 0
    for cat_dir in sorted(PRODUCT_LINK_PATH.iterdir()):
        if not cat_dir.is_dir() or cat_dir.name.startswith('.'):
            continue
        cat_order, cat_name = _parse_order(cat_dir.name)

        for subcat_dir in sorted(cat_dir.iterdir()):
            if not subcat_dir.is_dir() or subcat_dir.name.startswith('.'):
                continue
            subcat_order, subcat_name = _parse_order(subcat_dir.name)

            for prod_dir in sorted(subcat_dir.iterdir()):
                if not prod_dir.is_dir() or prod_dir.name.startswith('.'):
                    continue
                prod_order, _ = _parse_order(prod_dir.name)

                readme = prod_dir / 'README.md'
                if not readme.exists():
                    continue
                p = _parse_readme(readme)
                if not p or not p['name']:
                    continue

                conn.execute('''
                    INSERT INTO products
                        (name, category, subcategory,
                         cat_order, subcat_order, prod_order,
                         price, product_url, image_url)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(product_url) DO UPDATE SET
                        name         = excluded.name,
                        category     = excluded.category,
                        subcategory  = excluded.subcategory,
                        cat_order    = excluded.cat_order,
                        subcat_order = excluded.subcat_order,
                        prod_order   = excluded.prod_order,
                        price        = excluded.price,
                        image_url    = excluded.image_url
                ''', (
                    p['name'], cat_name, subcat_name,
                    cat_order, subcat_order, prod_order,
                    p['price'], p['product_url'], p['image_url'],
                ))
                count += 1

    conn.commit()
    return count


# ── Compatibility helpers ─────────────────────────────────────────────────────

def ordered_ids(a: int, b: int) -> tuple[int, int]:
    return (a, b) if a < b else (b, a)


def get_compatible(conn: sqlite3.Connection, product_id: int) -> list[dict]:
    rows = conn.execute('''
        SELECT p.id, p.name, p.price, p.product_url, p.image_url,
               c.notes, c.source
        FROM compatibility c
        JOIN products p ON p.id = CASE
            WHEN c.product_id_a = :pid THEN c.product_id_b
            ELSE c.product_id_a
        END
        WHERE c.product_id_a = :pid OR c.product_id_b = :pid
        ORDER BY p.name
    ''', {'pid': product_id}).fetchall()
    return [dict(r) for r in rows]


# ── Setup ─────────────────────────────────────────────────────────────────────

def setup() -> None:
    conn = get_db()
    init_schema(conn)
    n = index_products(conn)
    conn.close()
    print(f'[cytron_db] indexed {n} products → {DB_PATH}')


if __name__ == '__main__':
    setup()
