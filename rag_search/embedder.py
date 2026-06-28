"""
Embedding module — paraphrase-multilingual-mpnet-base-v2
  - รองรับภาษาไทย + อังกฤษ + ภาษาผสม
  - 768-dimension vectors
  - ดีกว่า MiniLM ในการค้นหาแบบ mixed Thai+English
"""
import sys
import numpy as np
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from cytron_db import get_db

MODEL_NAME = 'paraphrase-multilingual-mpnet-base-v2'
VECTOR_DIM  = 768
_model = None


def get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        print(f'[embedder] loading {MODEL_NAME}...')
        _model = SentenceTransformer(MODEL_NAME)
        print('[embedder] ready')
    return _model


def embed(texts: list[str]) -> np.ndarray:
    """Embed list of texts → 2D array (N × 768)"""
    return get_model().encode(
        texts,
        normalize_embeddings=True,
        show_progress_bar=False,
        batch_size=64,
    )


def embed_one(text: str) -> np.ndarray:
    """Embed single text → 1D array (768,)"""
    return embed([text])[0]


def vec_to_blob(vec: np.ndarray) -> bytes:
    return vec.astype(np.float32).tobytes()


def blob_to_vec(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)


def populate_embeddings(force: bool = False) -> dict:
    """
    Generate embedding for each product (name + description) → store as BLOB.
    force=True: re-embed ทุก product แม้มี embedding อยู่แล้ว
    """
    conn = get_db()

    cols = [r[1] for r in conn.execute('PRAGMA table_info(products)').fetchall()]
    if 'embedding' not in cols:
        conn.execute('ALTER TABLE products ADD COLUMN embedding BLOB')
        conn.commit()

    if force:
        rows = conn.execute('SELECT id, name, description FROM products').fetchall()
    else:
        rows = conn.execute(
            'SELECT id, name, description FROM products WHERE embedding IS NULL'
        ).fetchall()

    if not rows:
        conn.close()
        return {'embedded': 0, 'skipped': 0}

    print(f'[embedder] embedding {len(rows)} products...')
    texts = [f"{r['name']} {r['description']}" for r in rows]
    vecs  = get_model().encode(
        texts, normalize_embeddings=True, batch_size=64, show_progress_bar=True
    )

    for row, vec in zip(rows, vecs):
        conn.execute(
            'UPDATE products SET embedding = ? WHERE id = ?',
            (vec_to_blob(vec), row['id'])
        )

    conn.commit()
    total = conn.execute('SELECT COUNT(*) FROM products').fetchone()[0]
    done  = conn.execute(
        'SELECT COUNT(*) FROM products WHERE embedding IS NOT NULL'
    ).fetchone()[0]
    conn.close()
    print(f'[embedder] done: {done}/{total} products')
    return {'embedded': len(rows), 'skipped': total - len(rows)}


if __name__ == '__main__':
    populate_embeddings(force=True)
