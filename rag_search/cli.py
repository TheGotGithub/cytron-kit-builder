#!/usr/bin/env python3
"""
CLI ทดสอบ product search
รันด้วย:
  python3 -m rag_search.cli           ← vector mode (default)
  python3 -m rag_search.cli --hybrid  ← hybrid mode (vector + keyword)
  python3 -m rag_search.cli --keyword ← keyword mode
  python3 -m rag_search.cli --reindex ← re-embed ทุก product แล้วออก
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from cytron_db import DB_PATH


def run():
    if '--reindex' in sys.argv:
        from rag_search import reindex
        print('[cli] re-indexing all products...')
        result = reindex(force=True)
        print(f"[cli] done: embedded={result['embedded']} skipped={result['skipped']}")
        return

    if '--hybrid' in sys.argv:
        mode = 'hybrid'
    elif '--keyword' in sys.argv:
        mode = 'keyword'
    else:
        mode = 'vector'

    print('=' * 52)
    print(f'  Cytron Product Search — {mode} mode')
    print(f'  DB: {DB_PATH.name}')
    print('=' * 52)
    print("พิมพ์ keyword | 'q' เพื่อออก\n")

    if mode == 'hybrid':
        from rag_search.hybrid_searcher import search, format_result
        from rag_search.vector_searcher import ensure_ready
        ensure_ready()
    elif mode == 'vector':
        from rag_search.vector_searcher import search, format_result, ensure_ready
        ensure_ready()
    else:
        from rag_search.indexer  import populate_descriptions
        from rag_search.searcher import search, format_result
        populate_descriptions()

    while True:
        try:
            query = input('ค้นหา > ').strip()
        except (EOFError, KeyboardInterrupt):
            print('\nออกจากโปรแกรม')
            break

        if not query:
            continue
        if query.lower() in ('q', 'quit', 'exit'):
            print('ออกจากโปรแกรม')
            break

        results = search(query, limit=5)
        print()
        print(format_result(results))
        print()


if __name__ == '__main__':
    run()
