#!/usr/bin/env bash
# setup_tunnel.sh — ติดตั้ง Cloudflare Tunnel สำหรับ Cytron Kit Builder
# รัน: sudo bash setup_tunnel.sh
# ต้องรัน setup.sh ก่อน (ให้แอปทำงานที่ port 5050)

set -e

TUNNEL_NAME="cytron-kit"
APP_PORT=5050

echo "======================================"
echo " Cloudflare Tunnel — Setup"
echo " Tunnel: $TUNNEL_NAME → localhost:$APP_PORT"
echo "======================================"

# ── 1. ตรวจสอบ cloudflared ───────────────────────────────
echo ""
echo "[1/4] ติดตั้ง cloudflared..."
if command -v cloudflared &>/dev/null; then
    echo "cloudflared มีอยู่แล้ว: $(cloudflared --version)"
else
    ARCH=$(uname -m)
    if [ "$ARCH" = "aarch64" ]; then
        CF_BIN="cloudflared-linux-arm64"
    else
        CF_BIN="cloudflared-linux-amd64"
    fi

    echo "ดาวน์โหลด $CF_BIN..."
    curl -L "https://github.com/cloudflare/cloudflared/releases/latest/download/${CF_BIN}" \
         -o /tmp/cloudflared
    mv /tmp/cloudflared /usr/local/bin/cloudflared
    chmod +x /usr/local/bin/cloudflared
    echo "ติดตั้ง cloudflared เสร็จ: $(cloudflared --version)"
fi

# ── 2. Login Cloudflare ───────────────────────────────────
echo ""
echo "[2/4] Login Cloudflare..."
echo "--------------------------------------"
echo "จะเปิดลิงก์ให้ authorize ใน browser"
echo "ถ้า browser ไม่เปิดอัตโนมัติ ให้ copy URL ที่แสดงไปเปิดเอง"
echo "--------------------------------------"
cloudflared tunnel login

# ── 3. สร้าง tunnel ───────────────────────────────────────
echo ""
echo "[3/4] สร้าง tunnel '$TUNNEL_NAME'..."
if cloudflared tunnel list 2>/dev/null | grep -q "$TUNNEL_NAME"; then
    echo "tunnel '$TUNNEL_NAME' มีอยู่แล้ว ข้ามขั้นตอนนี้"
else
    cloudflared tunnel create "$TUNNEL_NAME"
    echo "สร้าง tunnel เสร็จ"
fi

# สร้าง config file
mkdir -p /etc/cloudflared

TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | grep "$TUNNEL_NAME" | awk '{print $1}')
CRED_FILE=$(ls ~/.cloudflared/${TUNNEL_ID}.json 2>/dev/null || echo "~/.cloudflared/${TUNNEL_ID}.json")

cat > /etc/cloudflared/config.yml <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CRED_FILE}

ingress:
  - service: http://localhost:${APP_PORT}
EOF

echo "สร้าง config ที่ /etc/cloudflared/config.yml"

# ── 4. ติดตั้ง systemd service ────────────────────────────
echo ""
echo "[4/4] ติดตั้ง cloudflared เป็น systemd service..."
cloudflared service install
systemctl enable cloudflared
systemctl restart cloudflared

echo ""
echo "======================================"
echo " Tunnel พร้อมใช้งาน!"
echo ""
echo " URL ของคุณ:"
cloudflared tunnel info "$TUNNEL_NAME" 2>/dev/null | grep -i "url\|route" || \
    echo " รัน: cloudflared tunnel info $TUNNEL_NAME"
echo ""
echo " ตรวจสถานะ: sudo systemctl status cloudflared"
echo " ดู log    : sudo journalctl -u cloudflared -f"
echo "======================================"
