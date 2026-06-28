#!/usr/bin/env bash
# setup.sh — First-run setup สำหรับ Cytron Kit Search
# รัน: bash setup.sh
# ทดสอบบน: Raspberry Pi CM5 (ARM64), Ubuntu/Debian

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$REPO_DIR/venv"
SERVICE_NAME="cytron-kit"
APP_PORT=5050

echo "======================================"
echo " Cytron Kit Search — Setup"
echo " Dir : $REPO_DIR"
echo " Port: $APP_PORT"
echo "======================================"

# ── 1. Python version check ───────────────────────────────
echo ""
echo "[1/5] ตรวจสอบ Python..."
if ! command -v python3 &>/dev/null; then
    echo "ไม่พบ python3 — กรุณาติดตั้งก่อน:"
    echo "  sudo apt install python3 python3-pip python3-venv"
    exit 1
fi
PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "Python $PY_VER พบแล้ว"

# ── 2. Virtual environment ────────────────────────────────
echo ""
echo "[2/5] สร้าง virtual environment..."
if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR"
    echo "สร้าง venv ที่ $VENV_DIR"
else
    echo "venv มีอยู่แล้ว ข้ามขั้นตอนนี้"
fi

source "$VENV_DIR/bin/activate"

# ── 3. Install dependencies ───────────────────────────────
echo ""
echo "[3/5] ติดตั้ง dependencies..."
echo "หมายเหตุ: torch + sentence-transformers อาจใช้เวลา 10-20 นาทีบน CM5"
pip install --upgrade pip --quiet

# ARM64 (RPi): ใช้ CPU-only torch wheel ที่เล็กกว่า
ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ]; then
    echo "ตรวจพบ ARM64 (RPi) — ใช้ torch CPU wheel"
    pip install torch --index-url https://download.pytorch.org/whl/cpu --quiet
fi

pip install -r "$REPO_DIR/requirements.txt" --quiet
echo "ติดตั้ง dependencies เสร็จ"

# ── 4. Database setup + index ─────────────────────────────
echo ""
echo "[4/5] ตั้งค่าฐานข้อมูลและ embedding..."
cd "$REPO_DIR"

# สร้าง DB ถ้ายังไม่มี
python3 -c "from cytron_db import setup; setup()" 2>/dev/null || true

# Populate descriptions จาก specs.md (ถ้ามี product_link/)
if [ -d "$REPO_DIR/product_link" ]; then
    echo "พบ product_link/ — กำลัง index descriptions..."
    python3 -c "from rag_search.indexer import populate_descriptions; populate_descriptions()"
else
    echo "ไม่พบ product_link/ — ข้ามการ index descriptions"
fi

# Download model + สร้าง embeddings (ครั้งแรกใช้เวลาสักครู่)
echo "กำลังสร้าง embeddings (ดาวน์โหลด model ~1.1GB ครั้งแรก)..."
python3 -c "from rag_search.embedder import populate_embeddings; populate_embeddings(force=False)"
echo "Embeddings พร้อมใช้งาน"

# ── 5. Systemd service ────────────────────────────────────
echo ""
echo "[5/5] ตั้งค่า systemd service..."

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [ "$(id -u)" -ne 0 ]; then
    echo "ข้าม systemd (ต้องการ sudo) — รันแอปด้วยคำสั่ง:"
    echo ""
    echo "  source $VENV_DIR/bin/activate"
    echo "  python3 $REPO_DIR/kit_list_app/app.py"
    echo ""
else
    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Cytron Kit Search App
After=network.target

[Service]
Type=simple
User=$SUDO_USER
WorkingDirectory=$REPO_DIR
ExecStart=$VENV_DIR/bin/python3 $REPO_DIR/kit_list_app/app.py
Restart=on-failure
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    systemctl restart "$SERVICE_NAME"
    echo "Service '$SERVICE_NAME' เริ่มทำงานแล้ว"
    echo "ตรวจสถานะ: sudo systemctl status $SERVICE_NAME"
fi

# ── Done ──────────────────────────────────────────────────
echo ""
echo "======================================"
echo " Setup เสร็จสิ้น!"
echo " เปิดใช้งานที่: http://localhost:$APP_PORT"
echo "======================================"
