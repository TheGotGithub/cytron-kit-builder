# Cytron Kit Builder

เครื่องมือภายในสำหรับทีม Technical Support ของ Cytron Thailand — ใช้ค้นหาสินค้าด้วยภาษาธรรมชาติ (ไทย/อังกฤษ/ผสม) และสร้าง Kit List ส่งลูกค้าผ่าน Line ได้ทันที

ออกแบบให้รันบน **Raspberry Pi CM5** หรือเครื่อง Linux ทั่วไปบน LAN

---

## Features

- **Hybrid Search** — ค้นหาด้วย semantic vector (70%) + keyword (30%) รองรับ Thai/EN/ผสม
- **Product Variants** — สินค้าที่มีหลายตัวเลือก (สี, ขนาด) แสดง dropdown ให้เลือกก่อนเพิ่ม
- **Kit List Generator** — เลือกสินค้า ปรับจำนวน drag เรียงลำดับ แล้ว copy format ส่ง Line ได้เลย
- **Batch Search** — วาง BOM / รายการสินค้าทีละหลายรายการ ค้นหาพร้อมกัน
- **Product Manager** — CRUD สินค้า, จัดการ compatibility links ผ่าน UI
- **No-stock Placeholder** — เพิ่มรายการที่ไม่มีสินค้าเข้า Kit List พร้อม flag `ไม่มีสินค้า`
- **Substitute Flag** — mark รายการว่าเป็นสินค้าทดแทน `[ทดแทน]` ใน output

---

## Tech Stack

| ส่วน | ของที่ใช้ |
|---|---|
| Backend | Python 3, Flask |
| Search | `sentence-transformers` (`paraphrase-multilingual-mpnet-base-v2`, 768-dim) |
| Database | SQLite (รวม embedding BLOB ไว้ในไฟล์เดียว) |
| Frontend | Vanilla JS + CSS (ไม่มี framework) |
| Target hardware | Raspberry Pi CM5 (ARM64) / Linux x86-64 |

---

## โครงสร้างโปรเจกต์

```
cytron-kit-builder/
├── cytron_db/               ← shared database module
│   ├── __init__.py
│   ├── db.py                ← get_db(), setup(), schema, compatibility API
│   └── cytron.db            ← SQLite (สินค้า + embeddings + logs)
│
├── kit_list_app/            ← Flask web app หลัก (port 5050)
│   ├── app.py               ← routes: catalog, search, compatibility, products CRUD
│   ├── static/
│   │   ├── app.js           ← Kit List UI logic
│   │   ├── style.css        ← Kit List styles
│   │   ├── products.js      ← Product Manager UI logic
│   │   └── products.css     ← Product Manager styles
│   └── templates/
│       ├── index.html       ← Kit List page
│       └── products.html    ← Product Manager page
│
├── rag_search/              ← search engine module
│   ├── embedder.py          ← โหลด model, embed สินค้า, เก็บลง DB
│   ├── vector_searcher.py   ← vector search + query expansion + re-rank
│   ├── hybrid_searcher.py   ← hybrid search (vector + keyword, alpha=0.7)
│   ├── searcher.py          ← keyword search (substring match)
│   ├── indexer.py           ← populate descriptions จาก specs.md
│   ├── parser.py            ← parse product_link/ folder
│   ├── cli.py               ← interactive CLI
│   └── SYSTEM.md            ← เอกสาร architecture ฉบับเต็ม
│
├── search_api/              ← standalone REST API (port 5001)
│   └── app.py               ← GET /search, GET /health, POST /reindex
│
├── requirements.txt
├── setup.sh                 ← first-run setup + systemd service
├── setup_tunnel.sh          ← Cloudflare tunnel (remote access)
└── .env.example
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
    embedding    BLOB,                          -- numpy float32 array (768-dim)
    parent_id    INTEGER REFERENCES products(id)  -- สำหรับ product variants
);

CREATE TABLE compatibility (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id_a INTEGER NOT NULL,
    product_id_b INTEGER NOT NULL,
    notes        TEXT    NOT NULL DEFAULT '',
    source       TEXT    NOT NULL DEFAULT 'manual',
    UNIQUE(product_id_a, product_id_b)
);

CREATE TABLE logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           DATETIME DEFAULT CURRENT_TIMESTAMP,
    session_id   TEXT,
    event        TEXT NOT NULL,
    query        TEXT,
    product_id   INTEGER,
    product_name TEXT
);
```

---

## Setup

### Requirements

- Python 3.10+
- pip, venv

### ติดตั้งครั้งแรก

```bash
git clone https://github.com/TheGotGithub/cytron-kit-builder.git
cd cytron-kit-builder
bash setup.sh
```

`setup.sh` จะทำขั้นตอนทั้งหมดให้อัตโนมัติ:
1. ตรวจสอบ Python version
2. สร้าง virtual environment
3. `pip install -r requirements.txt` (torch + sentence-transformers — ใช้เวลา 10–20 นาทีบน CM5)
4. สร้าง SQLite DB และ embeddings (ดาวน์โหลด model ~1.1 GB ครั้งแรก)
5. ตั้งค่า systemd service (ถ้ารันด้วย sudo)

### ตั้งค่า environment (optional)

```bash
cp .env.example .env
# แก้ PORT และ HOST ตามต้องการ
```

### รัน manually

```bash
source venv/bin/activate
python3 kit_list_app/app.py
# เปิดที่ http://localhost:5050
```

---

## การใช้งาน

### Kit List Generator (`http://localhost:5050`)

1. ค้นหาสินค้าในช่อง search หรือ browse จาก sidebar
2. กด **+ เพิ่ม** เพื่อเพิ่มสินค้าเข้า Kit List (ถ้ามี variant ให้เลือก dropdown ก่อน)
3. ปรับจำนวน, drag เรียงลำดับ, เพิ่ม note ได้
4. กด **📋 Copy ทั้งหมด** แล้ววางใน Line ได้เลย

**output format:**
```
1. NodeMCU ESP32 (x2)
THB420.00
https://th.cytron.io/p-nodemcu-esp32
--------------
2. DHT22 Temperature and Humidity Sensor
THB250.00
https://th.cytron.io/p-dht22
--------------
```

### Product Manager (`http://localhost:5050/products`)

- เพิ่ม/แก้ไข/ลบสินค้า
- จัดการ compatibility links ระหว่างสินค้า

### Search API (`http://localhost:5001`)

```bash
# ตรวจสอบสถานะ
GET /health

# ค้นหา
GET /search?q=มอเตอร์ไดรเวอร์&limit=5

# re-embed ทั้งหมด
POST /reindex
Header: X-Admin-Key: cytron-admin
```

### CLI

```bash
python3 -m rag_search.cli                # vector search
python3 -m rag_search.cli --hybrid       # hybrid search (แนะนำ)
python3 -m rag_search.cli --keyword      # keyword only
python3 -m rag_search.cli --reindex      # re-embed ทั้งหมดแล้วออก
```

---

## Search Engine

ใช้ **Hybrid Search** เป็น default: `score = 0.7 × vector_score + 0.3 × keyword_score`

| Mode | เหมาะกับ | ตัวอย่าง |
|---|---|---|
| Vector | คำทั่วไป, ข้ามภาษา | "มอเตอร์ไดรเวอร์" → Motor Driver |
| Keyword | product code, ตรงๆ | "DHT22", "HC-SR04" |
| Hybrid | ทุก case | ค่าเริ่มต้น |

**Embedding model:** `paraphrase-multilingual-mpnet-base-v2` (768-dim, รองรับ 50+ ภาษา รวมไทย)

**Score thresholds:**
- `≥ 0.60` → ✅ found
- `≥ 0.40` → ⚠️ suggest
- `< 0.40` → ❌ not_found

**Query expansion:** รู้จัก alias เช่น `pi5` → `Raspberry Pi 5 Single Board Computer`, `cm5` → `Raspberry Pi Compute Module 5`

---

## Deployment บน Raspberry Pi CM5

```bash
# setup ครั้งแรก (รันด้วย sudo เพื่อสร้าง systemd service)
sudo bash setup.sh

# ตรวจสอบ service
sudo systemctl status cytron-kit

# เข้าใช้งานจาก LAN
http://<IP-ของ-RPi>:5050

# เปิด remote access ผ่าน Cloudflare Tunnel (optional)
bash setup_tunnel.sh
```

---

## เอกสารเพิ่มเติม

ดู [`rag_search/SYSTEM.md`](rag_search/SYSTEM.md) สำหรับรายละเอียด architecture, known issues, และ roadmap
