"""
Populate products.description in SQLite from specs.md files.
Run once (or re-run after new specs.md are added).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from cytron_db import get_db
from rag_search.parser import iter_products, build_rag_text


def populate_descriptions(force: bool = False) -> dict:
    """
    Update products.description from specs.md.
    Returns {'updated': n, 'skipped': n, 'not_found': n}
    """
    conn  = get_db()
    stats = {'updated': 0, 'skipped': 0, 'not_found': 0}

    for rd, sd, _ in iter_products():
        url = rd.get('product_url', '')
        if not url:
            stats['not_found'] += 1
            continue

        row = conn.execute(
            'SELECT id, description FROM products WHERE product_url = ?', (url,)
        ).fetchone()

        if not row:
            stats['not_found'] += 1
            continue

        if row['description'] and not force:
            stats['skipped'] += 1
            continue

        rag_text = build_rag_text(rd['name'], '', '', sd)
        conn.execute(
            'UPDATE products SET description = ? WHERE id = ?',
            (rag_text, row['id'])
        )
        stats['updated'] += 1

    conn.commit()
    conn.close()
    return stats


if __name__ == '__main__':
    result = populate_descriptions()
    print(f"[indexer] updated={result['updated']} skipped={result['skipped']} not_found={result['not_found']}")
