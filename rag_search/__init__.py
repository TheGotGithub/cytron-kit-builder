"""
rag_search — Cytron Product Search Module

Public API:
    from rag_search import search, hybrid_search, reindex

    results = search("มอเตอร์ไดรเวอร์ 12V")          # vector only
    results = hybrid_search("DHT22", alpha=0.7)       # vector + keyword
    # [{'id', 'name', 'price', 'product_url', 'image_url', 'score', 'status'}, ...]
    # status: 'found' | 'suggest' | 'not_found'

    reindex()   # re-embed ทุก product ใหม่ (ใช้หลัง update สินค้า)
"""
from rag_search.vector_searcher import search, ensure_ready
from rag_search.hybrid_searcher import search as hybrid_search
from rag_search.embedder        import populate_embeddings


def reindex(force: bool = True) -> dict:
    """Re-embed all products. Call after adding/editing products."""
    from rag_search.indexer import populate_descriptions
    populate_descriptions(force=force)
    return populate_embeddings(force=force)


__all__ = ['search', 'hybrid_search', 'reindex', 'ensure_ready']
