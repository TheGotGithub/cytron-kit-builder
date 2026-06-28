# rag_search — Cytron Product Search System

เอกสารนี้อธิบายระบบ RAG Search + Kit List สำหรับ AI หรือ developer ที่จะเข้ามาทำงานต่อ
ครอบคลุมสถาปัตยกรรม, การตัดสินใจสำคัญ, ข้อจำกัด, changelog, และ roadmap

---

## บริบทโปรเจกต์

**เป้าหมาย:** เครื่องมือภายใน Cytron Thailand สำหรับทีม Technical Support ใช้ค้นหาสินค้าด้วยภาษาธรรมชาติ (ไทย/อังกฤษ/ผสม) แทน keyword search แบบเดิมที่ต้องพิมพ์ตรงๆ

**ปัญหาที่แก้:** ลูกค้าถามว่า "บอร์ดขยาย" แต่สินค้าชื่อ "Expansion Board" — keyword search ไม่เจอ, vector search เจอ

**Scale ปัจจุบัน:** 901 สินค้า (SQLite, local machine)

---

## โครงสร้างไฟล์

```
software/
├── cytron_db/                   ← shared database module
│   ├── __init__.py
│   └── db.py                    ← get_db(), setup(), DB_PATH
│
├── rag_search/                  ← โมดูลหลัก
│   ├── SYSTEM.md                ← เอกสารนี้
│   ├── __init__.py              ← public API: search(), hybrid_search(), reindex()
│   ├── parser.py                ← parse product_link/ folder
│   ├── indexer.py               ← populate products.description ใน DB
│   ├── embedder.py              ← embedding model + store BLOB ใน DB
│   ├── vector_searcher.py       ← vector search + query expansion + re-rank
│   ├── hybrid_searcher.py       ← hybrid search (vector + keyword)
│   ├── searcher.py              ← keyword search (baseline/component)
│   ├── cli.py                   ← CLI interactive (--hybrid / --keyword / --reindex)
│   └── tests/
│       ├── __init__.py
│       ├── test_search_pi5.py   ← unit test 22 cases + analysis plot
│       └── analysis_pi5.png     ← scatter plot before/after expansion
│
├── kit_list_app/                ← Flask web app (port 5050)
│   ├── app.py                   ← ใช้ hybrid_search() เป็น default
│   ├── static/
│   │   ├── app.js               ← debounce 400ms + async + score badge
│   │   └── style.css
│   └── templates/
│       ├── index.html
│       └── products.html
│
├── search_api/                  ← standalone Flask REST API (port 5001)
│   └── app.py                   ← GET /search, GET /health, POST /reindex
│
├── temp/                        ← output ชั่วคราว (search result exports)
│   └── product_search_results.md  ← ผล BOM search 16 รายการ (2026-06-26)
│
├── test/                        ← learning + analysis scripts
│   ├── 01_what_is_embedding.py
│   ├── 02_similarity.py
│   ├── 02b_similarity_plot.py
│   ├── 03_mini_search.py
│   ├── 04_compare_models.py     ← เปรียบ 3 models → เลือก mpnet
│   ├── 05_chromadb.py           ← ChromaDB vs SQLite BLOB
│   ├── 06_hybrid_search.py      ← prototype hybrid + bar chart เปรียบ 3 modes
│   ├── 06_raspberry_pi_5_plot.py ← scatter plot Pi5 score vs desc length
│   ├── 07_standardize_reembed.py ← re-embed ทั้งหมดด้วย formula ใหม่
│   ├── 08_clustering_analysis.py ← K-Means clustering 901 สินค้า + PCA plot
│   ├── 08_tune_clustering.py    ← tune K ด้วย elbow method
│   └── 09_advanced_clustering.py
│
└── rag_search_oldmodel/         ← เวอร์ชันเก่า (MiniLM 384-dim) เก็บไว้อ้างอิง
```

---

## Database Schema

```sql
CREATE TABLE products (
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
    description  TEXT    NOT NULL DEFAULT '',  -- RAG text จาก specs.md
    embedding    BLOB                          -- numpy float32 array (768 dims)
);

CREATE TABLE compatibility (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id_a INTEGER NOT NULL,
    product_id_b INTEGER NOT NULL,
    notes        TEXT NOT NULL DEFAULT '',
    source       TEXT NOT NULL DEFAULT 'manual',
    UNIQUE(product_id_a, product_id_b)
);
```

**หมายเหตุ:**
- `description` มาจาก `indexer.py` ที่ parse `product_link/*/specs.md`
- `embedding` = `numpy.ndarray(768, dtype=float32).tobytes()` — normalize แล้ว (norm=1.0)
- 138 จาก 901 สินค้าไม่มี description (ไม่มีไฟล์ specs.md) — embedding ทำจาก name + category

---

## Embedding Model

| ค่า | |
|---|---|
| Model | `paraphrase-multilingual-mpnet-base-v2` |
| Source | HuggingFace via `sentence-transformers` |
| Cache | `~/.cache/huggingface/hub/` (~1.1 GB) |
| Dimensions | 768 |
| Languages | 50+ รวม Thai + English |
| Normalize | `normalize_embeddings=True` (norm = 1.0 เสมอ) |

**เหตุผลที่เลือก model นี้** (จาก `test/04_compare_models.py`):

| Model | Thai | EN | Mixed |
|---|---|---|---|
| `MiniLM-L12-v2` (384-dim) | ปานกลาง | ดี | ⚠️ SUGGEST |
| `all-MiniLM-L6-v2` (EN-only) | ❌ พัง | ดี | ❌ |
| **`mpnet-base-v2` (768-dim)** | ดี | ดี | ✅ FOUND |

ตัวชี้ขาด: query "ESP-WROOM-32 บอร์ดขยาย" → MiniLM: 0.574 (SUGGEST) vs mpnet: 0.710 (FOUND)

---

## Embedding Formula (ปัจจุบัน)

```python
# embedder.py / test/07_standardize_reembed.py
def build_embed_text(row) -> str:
    name = row['name']
    desc = row['description'].strip() or f"{row['category']} {row['subcategory']}"
    return f"{name} {name} {desc[:500]}"
```

- `name` ซ้ำ 2 ครั้ง → เพิ่ม weight ของ name ใน mean pooling
- `desc[:500]` → ตัด description ไม่ให้ยาวเกิน (ป้องกัน vector dilution)
- ถ้าไม่มี description → ใช้ `category + subcategory` แทน

**Re-embed ครั้งล่าสุด:** 2026-06-25 — 901 สินค้า

---

## Search Modes

### 1. Vector Search (`vector_searcher.py`)

```
query → _expand() → embed_one() → matrix @ query_vec → top-k candidates
      → _name_match() re-rank (เฉพาะตอน expansion เกิดขึ้น)
      → deduplicate by slug
      → return top-limit
```

### 2. Hybrid Search (`hybrid_searcher.py`) — **default ใน app**

```python
hscore = alpha * vector_score + (1 - alpha) * keyword_score
# alpha=0.7 (default): 70% vector + 30% keyword
```

ทำไมต้อง hybrid:
- vector ดีกับ semantic / ข้ามภาษา ("มอเตอร์ไดรเวอร์" → Motor Driver)
- keyword ดีกับ product code ("DHT22", "HC-SR04")
- ตัวอย่าง: DHT22 → vector SUGGEST (0.482) → hybrid FOUND (0.637) ✅

ปรับ alpha ตาม use case:
- alpha สูง (0.8+) → เน้น semantic / multi-language
- alpha ต่ำ (0.5) → เน้น exact match / product code

### 3. Keyword Search (`searcher.py`)

ใช้ substring match ธรรมดา ไม่ semantic — เป็น component ของ hybrid เท่านั้น

---

## Score Thresholds

```python
SCORE_FOUND   = 0.60   # ✅ found
SCORE_SUGGEST = 0.40   # ⚠️ suggest
                       # < 0.40 → ❓ not_found
```

thresholds เป็นค่า empirical ยังไม่ได้ tune กับ labeled dataset

---

## Query Expansion

```python
_EXPANSIONS = {
    'pi5':        'Raspberry Pi 5 Single Board Computer',
    'pi 5':       'Raspberry Pi 5 Single Board Computer',
    'rpi5':       'Raspberry Pi 5 Single Board Computer',
    'rpi 5':      'Raspberry Pi 5 Single Board Computer',
    'pi4':        'Official Raspberry Pi 4 Model B',
    'pi 4':       'Official Raspberry Pi 4 Model B',
    'rpi4':       'Official Raspberry Pi 4 Model B',
    'rpi 4':      'Official Raspberry Pi 4 Model B',
    'pi4b':       'Official Raspberry Pi 4 Model B',
    'pi 4b':      'Official Raspberry Pi 4 Model B',
    'pi3':        'Raspberry Pi 3',
    'pi 3':       'Raspberry Pi 3',
    'pizero':     'Raspberry Pi Zero',
    'pi zero':    'Raspberry Pi Zero',
    'pi0':        'Raspberry Pi Zero',
    'rpi0':       'Raspberry Pi Zero',
    'pi zero 2w': 'Raspberry Pi Zero 2 W',
    'pi zero2w':  'Raspberry Pi Zero 2 W',
    'cm4':        'Raspberry Pi Compute Module 4',
    'cm5':        'Raspberry Pi Compute Module 5',
}
```

**ทำไมต้องมี expansion:** model ไม่รู้ว่า "Pi5" = "Raspberry Pi 5" เพราะเป็น engineer slang
— ถ้าไม่มี expansion "Pi5" ได้ผล "Raspberry Pi Beginner's Guide 5th Edition" แทน

**ข้อสำคัญ:** ต้องใส่ทั้ง `"pi5"` และ `"pi 5"` (มีช่องว่าง) แยกกัน เพราะ dict lookup ตรงๆ

---

## Deduplication

สินค้าบางชิ้นอยู่ใน 3 category ซ้ำกัน (เช่น ESP32 Smart Farm IoT Kit)
URL มี pattern `/c-{category}/p-{slug}` — ใช้ slug หลัง `/p-` เป็น key

```python
seen, unique = set(), []
for r in results:
    url  = r['product_url'] or ''
    slug = url.split('/p-')[-1] if '/p-' in url else r['name'].lower()
    if slug not in seen:
        seen.add(slug)
        unique.append(r)
```

ผล: ESP32 Smart Farm ขึ้นซ้ำ 4 ครั้ง → ขึ้นแค่ 1 ครั้ง ✅

---

## Re-ranking

เฉพาะตอนที่ query expansion เกิดขึ้น (expanded ≠ raw query):

```python
if was_expanded:
    results.sort(key=lambda r: (r['_nm'], r['score']), reverse=True)
else:
    results.sort(key=lambda r: r['score'], reverse=True)
```

ทำไมไม่ re-rank ทุก query: "มอเตอร์ไดรเวอร์ 12V" — re-rank จะ boost "Adapter 12V 2A" แทน Motor Driver

---

## Public API

```python
from rag_search import search, hybrid_search, reindex

# vector search
results = search("มอเตอร์ไดรเวอร์ 12V", limit=5)

# hybrid search (default ใน app)
results = hybrid_search("DHT22", limit=5, alpha=0.7)

# returns: list[dict]
# {
#   'id': int,
#   'name': str,
#   'price': str,          # "THB480.00"
#   'product_url': str,
#   'image_url': str,
#   'score': float,        # 0.0–1.0
#   'vscore': float,       # (hybrid เท่านั้น)
#   'kscore': float,       # (hybrid เท่านั้น)
#   'status': str          # 'found' | 'suggest' | 'not_found'
# }

# re-embed ทุกสินค้าใหม่
reindex(force=True)
```

---

## REST API (`search_api/app.py`)

```
GET  /health
     → {"status":"ok", "model":"...", "products_embedded":901, "startup_ms":238}

GET  /search?q=<query>&limit=5
     → {"query":"...", "count":5, "took_ms":39, "results":[...]}

POST /reindex
     Header: X-Admin-Key: cytron-admin
     → {"embedded":901, "skipped":0, "took_s":5.6}
```

รัน: `python3 search_api/app.py` (port 5001)

---

## Integration กับ kit_list_app (port 5050)

`kit_list_app/app.py` ใช้ **hybrid search** เป็น default:

```python
from rag_search.vector_searcher import ensure_ready
from rag_search.hybrid_searcher import search as _hybrid_search
ensure_ready()  # โหลด model ตอน startup

@app.route('/api/products/search')
def api_search():
    q = request.args.get('q', '').strip()
    results = _hybrid_search(q, limit=limit)   # ← hybrid
    return jsonify(results)
```

`kit_list_app/static/app.js`:
- debounce 400ms
- score badge: สีเขียว (found ≥ 0.60) / เหลือง (suggest ≥ 0.40) / แดง (not_found)

---

## Kit List BOM Search (2026-06-26)

ฟีเจอร์สำหรับค้นหาสินค้าจาก BOM / Kit List และ export ผลลงไฟล์

**วิธีใช้:**
```python
from rag_search.hybrid_searcher import search

items = [("DHT22", "DHT22 temperature humidity sensor"), ...]
for label, query in items:
    results = search(query, limit=3)
```

**Output:** `temp/product_search_results.md`

**ผลค้นหาล่าสุด (Smart Farm Kit 16 รายการ, 2026-06-26):**

| สถานะ | # | รายการ | สินค้าใน DB |
|---|---|---|---|
| ✅ FOUND | 4 | DHT22 | DHT22 Temperature and Humidity Sensor Module Breakout |
| ✅ FOUND | 8 | Micro Servo 9g | Analog Micro Servo 9g (3V-6V) |
| ✅ FOUND | 18 | Micro USB Cable | USB Micro B Cable |
| ✅ FOUND | 12 | Dupont wires | 40-Way 20cm Dupont Jumper Wire |
| ✅ FOUND | 6 | Mini Water Pump 3V-6V | Micro Submersible Water Pump DC 3V-5V |
| ✅ FOUND | 3 | Soil Humidity Sensor | Maker Soil Moisture Sensor (Capacitive) |
| ✅ FOUND | 10 | LED 5mm | LED 5mm Red/Green/Blue |
| ✅ FOUND | 11 | I2C 1602 LCD | 3V3 I2C and SPI 1602 Serial Character LCD |
| ⚠️ ใกล้เคียง | 1 | ESP32 ESP-WROOM-32 | NodeMCU ESP32 with Expansion Board (combo) |
| ⚠️ ใกล้เคียง | 2 | Baseboard ESP32 | NodeMCU ESP32 with Expansion Board (ตัวเดียวกัน) |
| ⚠️ ใกล้เคียง | 7 | Relay 5V 6-channel | มีแค่ 2ch/4ch/8ch ไม่มี 6ch |
| ⚠️ ใกล้เคียง | 5 | LDR + LM393 Module | Light Sensor Module (ไม่มี LM393 combo) |
| ⚠️ ใกล้เคียง | 13 | Power Supply 5V 2A | 5V 3A USB-C Adapter (ต่าง spec) |
| ❌ ไม่พบ | 9 | Passive Buzzer 5V | มีแค่ Active Buzzer |
| ❌ ไม่พบ | 15 | Motor Valve 3V/5V | ไม่มีใน DB |
| ❌ ไม่พบ | 17 | Terminal Block 600V 25A | ไม่มีใน DB |

---

## Known Issues

### 1. Vector Dilution จาก Description ยาว

**ปัญหา:** desc ยาว → mean pooling เจือ name signal
- desc 50 tok → name weight ≈ 9%
- desc 500 tok → name weight ≈ 1%

**แก้แล้ว:** ใช้ formula `f"{name} {name} {desc[:500]}"` + re-embed ทั้งหมด 2026-06-25
- Pi 5 board: อันดับ 7 → อันดับ 1 หลัง expansion + re-embed

**สินค้าที่ truncate description (2026-06-25):**

| id | ชื่อ | desc ก่อน | desc หลัง |
|---|---|---:|---:|
| 25 | Raspberry Pi 5 Single Board Computer | 13,781 | 287 chars |
| 18 | Official Raspberry Pi 4 Model B | 2,716 | 253 chars |
| 197 | 5MP Camera Board for Raspberry Pi | 2,559 | 234 chars |
| 175 | Raspberry Pi หน้าจอ 7 นิ้ว | 1,666 | 193 chars |

### 2. Thai-only Query ได้ SUGGEST ไม่ถึง FOUND

**ปัญหา:** "เซ็นเซอร์วัดระยะทาง" score สูงสุด ~0.596 เพราะสินค้าเป็น EN

**แนวทาง:** เพิ่ม Thai ใน description, หรือ Thai→EN query expansion

### 3. Keyword "12V" กว้างเกิน

**ปัญหา:** "มอเตอร์ไดรเวอร์ 12V" → ผล keyword โดน "Adapter 12V" แทน Motor Driver
keyword component ไม่เข้าใจ context — ยังไม่แก้

### 4. ไม่มี 6-channel Relay ใน DB

จาก BOM search พบว่ามีแค่ 2ch/4ch/8ch ไม่มี 6ch

### 5. ขาดสินค้า 3 รายการใน DB

Passive Buzzer 5V, Motor Valve 3V/5V, Terminal Block 600V 25A — ไม่มีใน catalog

### 6. Threshold ยังไม่ได้ Tune

SCORE_FOUND=0.60, SCORE_SUGGEST=0.40 เป็น empirical ยังไม่มี labeled dataset

---

## Roadmap

| Priority | งาน | Status |
|---|---|---|
| สูง | Hybrid Search (vector + keyword) | ✅ Done (2026-06-25) |
| สูง | Deduplication by URL slug | ✅ Done (2026-06-25) |
| สูง | Re-embed ด้วย formula ใหม่ (name×2 + desc[:500]) | ✅ Done (2026-06-25) |
| สูง | Query Expansion (Pi5/Pi4/RPi) + space variants | ✅ Done (2026-06-25) |
| สูง | Unit Tests 22 cases (Pi5 search) | ✅ Done (2026-06-25) |
| สูง | CLI --hybrid flag | ✅ Done (2026-06-25) |
| สูง | Kit List BOM Search + export ไฟล์ | ✅ Done (2026-06-26) |
| กลาง | Clustering analysis 901 สินค้า | ✅ Done (K-Means, 08_clustering_analysis.py) |
| กลาง | Semantic Tags ด้วย Gemini (138 สินค้าไม่มี desc) | ⏳ Prompt เขียนแล้ว รอ user run |
| กลาง | Evaluation Dataset (labeled pairs) | ❌ ยังไม่ได้ทำ |
| กลาง | Thai→EN query expansion เพิ่มเติม | ❌ ยังไม่ได้ทำ |
| ต่ำ | Line Bot integration | ❌ ยังไม่ได้ทำ |
| ต่ำ | LLM generate คำตอบจาก results | ❌ ยังไม่ได้ทำ |

---

## Changelog

### 2026-06-26

- **[Feature] Kit List BOM Search** — ค้นหา 16 รายการจาก Smart Farm Kit BOM
  - output: `temp/product_search_results.md`
  - สรุป: FOUND 8 / ใกล้เคียง 5 / ไม่พบ 3
  - ไม่พบ: Passive Buzzer, Motor Valve 3V/5V, Terminal Block 600V 25A

### 2026-06-25

- **[Feature] Hybrid Search** — `rag_search/hybrid_searcher.py`
  - `alpha * vector_score + (1-alpha) * keyword_score`, alpha=0.7 default
  - ทดสอบด้วย 7 test cases ใน `test/06_hybrid_search.py`
  - ผล DHT22: SUGGEST(0.482) → FOUND(0.637) ✅

- **[Feature] Deduplication** — by URL slug ใน vector_searcher + hybrid_searcher
  - ESP32 Smart Farm ซ้ำ 4 ครั้ง → ขึ้นแค่ 1 ✅

- **[Fix] Query Expansion space variants** — เพิ่ม "pi 5", "pi 4" (มีช่องว่าง) ใน dict
  - ก่อน: "Pi 5" → ไม่ match → ผลผิด
  - หลัง: "Pi 5" → expand → ผลถูก ✅

- **[Feature] Re-embed ทั้งหมด** — `test/07_standardize_reembed.py`
  - formula ใหม่: `f"{name} {name} {desc[:500]}"`
  - 901 สินค้า ใช้เวลา ~5.6 วินาที

- **[Fix] Truncate description** — 4 สินค้าที่ยาวเกิน (Pi5, Pi4, Camera, 7" Display)
  - Pi 5: 13,781 → 287 chars / Pi4: 2,716 → 253 chars

- **[Feature] Unit Tests** — `rag_search/tests/test_search_pi5.py`
  - 22 test cases: QueryExpansion, SearchRelevance, ScoreQuality, Regression, NameMatch
  - analysis plot: score vs desc_length before/after

- **[Feature] CLI --hybrid flag** — `rag_search/cli.py`
  - `python3 -m rag_search.cli --hybrid`

- **[Feature] Clustering Analysis** — `test/08_clustering_analysis.py`
  - K-Means, PCA 2D plot, 901 สินค้า
  - พบ: สินค้าบางชิ้นอยู่หลาย category โดย semantic cluster เดียวกัน

- **[Update] kit_list_app** — เปลี่ยนมาใช้ `hybrid_search` เป็น default

- **[Update] SYSTEM.md** — อัพเดทครั้งแรก

---

## Commands

```bash
# รัน app (port 5050)
python3 kit_list_app/app.py

# CLI interactive
python3 -m rag_search.cli                # vector mode
python3 -m rag_search.cli --hybrid       # hybrid mode
python3 -m rag_search.cli --keyword      # keyword mode
python3 -m rag_search.cli --reindex      # re-embed แล้วออก

# unit tests
python3 rag_search/tests/test_search_pi5.py   # analysis + 22 tests
python3 -m pytest rag_search/tests/ -v        # tests อย่างเดียว

# re-embed ทั้งหมด (หลัง update ข้อมูลหรือเปลี่ยน formula)
python3 -m rag_search.embedder
python3 test/07_standardize_reembed.py

# standalone REST API (port 5001)
python3 search_api/app.py

# clustering analysis
python3 test/08_clustering_analysis.py

# BOM search แบบ script
python3 -c "
from rag_search.hybrid_searcher import search
for r in search('DHT22', limit=3):
    print(r['status'], r['score'], r['name'])
"
```

---

## ข้อมูลที่ควรรู้ก่อนแก้ไข

1. **เปลี่ยน MODEL_NAME** → ต้อง re-embed ทุกสินค้า dim เปลี่ยน
2. **เปลี่ยน embed formula** → `populate_embeddings(force=True)`
3. **เพิ่มสินค้าใหม่** → `reindex()` (force=False ข้ามที่มี embedding แล้ว)
4. **embedding BLOB** = `np.ndarray(768, dtype=float32).tobytes()` normalized
5. **`rag_search_oldmodel/`** = MiniLM 384-dim เก็บไว้อ้างอิง ไม่ใช้แล้ว
6. **model lazy load** — โหลดครั้งแรกเมื่อ `embed_one()` ถูกเรียก, cache ใน global `_model`
   - โหลดครั้งแรก ~1–2 วินาที / request ถัดไป ~30–50 ms
   - files อยู่ที่ `~/.cache/huggingface/hub/` (~1.1 GB)
