#!/usr/bin/env bash
# Setup script for Aivastra ComfyUI worker VPS (Ubuntu 24.04)
# Run as root: bash setup-worker-vps.sh
#
# Required env vars (export before running, or script will prompt):
#   WORKER_DOMAIN   - public hostname, e.g. worker-a.tryon.example.com
#   WORKER_API_KEY  - secret key dispatcher sends as X-Worker-Key header
#                     (generate with: openssl rand -hex 32)
#
# After running this script:
#   1. Point DNS A record for $WORKER_DOMAIN to this VPS IP
#   2. Run: certbot --nginx -d $WORKER_DOMAIN  (for TLS)
#   3. Download ComfyUI models (see infra/comfyui/model-manifest.json)
#   4. systemctl start comfyui && systemctl enable comfyui

set -euo pipefail

# ── Prompt for required vars if not set ───────────────────────────────────────
if [[ -z "${WORKER_DOMAIN:-}" ]]; then
  read -rp "Worker domain (e.g. worker-a.tryon.example.com): " WORKER_DOMAIN
fi
if [[ -z "${WORKER_API_KEY:-}" ]]; then
  WORKER_API_KEY=$(openssl rand -hex 32)
  echo "Generated WORKER_API_KEY: $WORKER_API_KEY"
  echo "  -> Save this in dispatcher env as WORKER_A_API_KEY (or WORKER_B_API_KEY)"
fi

export WORKER_DOMAIN WORKER_API_KEY

# ── System packages ────────────────────────────────────────────────────────────
apt-get update -qq
apt-get install -y --no-install-recommends \
  python3.11 python3.11-venv python3-pip \
  git curl wget unzip \
  nginx certbot python3-certbot-nginx \
  gettext-base  # provides envsubst

# ── ComfyUI user + install ─────────────────────────────────────────────────────
if ! id comfyui &>/dev/null; then
  useradd -r -s /usr/sbin/nologin -d /opt/comfyui comfyui
fi

if [[ ! -d /opt/comfyui ]]; then
  git clone https://github.com/comfyanonymous/ComfyUI.git /opt/comfyui
fi

# Python venv + dependencies
if [[ ! -d /opt/comfyui/venv ]]; then
  python3.11 -m venv /opt/comfyui/venv
fi
/opt/comfyui/venv/bin/pip install --upgrade pip
/opt/comfyui/venv/bin/pip install -r /opt/comfyui/requirements.txt

chown -R comfyui:comfyui /opt/comfyui

# ── Systemd service ────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cp "$REPO_ROOT/infra/comfyui/comfyui.service" /etc/systemd/system/comfyui.service
systemctl daemon-reload

echo "ComfyUI service installed. Start with: systemctl start comfyui"

# ── nginx config ───────────────────────────────────────────────────────────────
envsubst '${WORKER_API_KEY} ${WORKER_DOMAIN}' \
  < "$REPO_ROOT/infra/nginx/worker.conf.template" \
  > /etc/nginx/sites-available/comfyui

# Remove default site if present
rm -f /etc/nginx/sites-enabled/default

ln -sf /etc/nginx/sites-available/comfyui /etc/nginx/sites-enabled/comfyui
nginx -t
systemctl reload nginx

# ── Firewall ───────────────────────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp    # SSH
  ufw allow 80/tcp    # HTTP (certbot + redirect)
  ufw allow 443/tcp   # HTTPS (nginx → ComfyUI)
  ufw deny 8188/tcp   # Block direct ComfyUI access from public
  ufw --force enable
  echo "UFW rules applied."
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo "Worker VPS setup complete."
echo ""
echo "WORKER_DOMAIN  : $WORKER_DOMAIN"
echo "WORKER_API_KEY : $WORKER_API_KEY"
echo ""
echo "Next steps:"
echo "  1. DNS: point $WORKER_DOMAIN A record → $(curl -s ifconfig.me)"
echo "  2. TLS: certbot --nginx -d $WORKER_DOMAIN"
echo "  3. Models: download to /opt/comfyui/models/ per model-manifest.json"
echo "  4. Start: systemctl enable --now comfyui"
echo "  5. Add to dispatcher env:"
echo "       WORKER_A_URL=https://$WORKER_DOMAIN"
echo "       WORKER_A_API_KEY=$WORKER_API_KEY"
echo "========================================"
