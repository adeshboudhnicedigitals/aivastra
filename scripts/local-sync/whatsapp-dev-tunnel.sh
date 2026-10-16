#!/usr/bin/env bash
# Linux/macOS twin of whatsapp-dev-tunnel.ps1 — fixed public URLs for testing the
# WhatsApp bot against a local stack.
#
# Meta must reach two local things: the api (webhook) and MinIO (carousel images,
# which Meta downloads by link). A cloudflared *quick* tunnel gives a new random
# URL on every start, which means re-pointing Meta's callback and .env each time.
# A *named* tunnel keeps the same hostnames for good.
#
# One-time setup (opens a browser to pick the Cloudflare zone, aivastra.com):
#   scripts/local-sync/whatsapp-dev-tunnel.sh --setup
# Every session after that:
#   scripts/local-sync/whatsapp-dev-tunnel.sh
#
# Then, once:
#   .env: R2_PUBLIC_PRESIGN_BASE=https://<MinioHost>
#   Meta callback URL: https://<ApiHost>/v1/whatsapp/webhook
# When you stop testing, put R2_PUBLIC_PRESIGN_BASE back to http://127.0.0.1:9000.
#
# Each developer uses their own --name and hostnames, so two machines never fight
# over one tunnel. Nothing here is a secret: the tunnel credentials file lives in
# ~/.cloudflared and never in the repo.
#
# Usage: whatsapp-dev-tunnel.sh [--setup] [--name N] [--api-host H] [--minio-host H]
set -euo pipefail

SETUP=0
NAME='aivastra-wa-dev'
API_HOST='wa-dev-api.aivastra.com'
MINIO_HOST='wa-dev-minio.aivastra.com'

while [ $# -gt 0 ]; do
  case "$1" in
    --setup) SETUP=1; shift ;;
    --name) NAME="$2"; shift 2 ;;
    --api-host) API_HOST="$2"; shift 2 ;;
    --minio-host) MINIO_HOST="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

command -v cloudflared >/dev/null || { echo "cloudflared not on PATH" >&2; exit 1; }
DIR="$HOME/.cloudflared"
CONFIG="$DIR/$NAME.yml"

if [ "$SETUP" -eq 1 ]; then
  command -v jq >/dev/null || { echo "jq required for --setup" >&2; exit 1; }
  [ -f "$DIR/cert.pem" ] || cloudflared tunnel login
  find_id() { cloudflared tunnel list --output json | jq -r --arg n "$NAME" '[.[] | select(.name == $n)][0].id // empty'; }
  [ -n "$(find_id)" ] || cloudflared tunnel create "$NAME"
  ID="$(find_id)"
  cloudflared tunnel route dns "$NAME" "$API_HOST"
  cloudflared tunnel route dns "$NAME" "$MINIO_HOST"
  # MinIO's presigned signatures cover the Host header, and URLs are signed for
  # 127.0.0.1:9000 locally; rewriting Host keeps them valid through the tunnel.
  cat > "$CONFIG" <<EOF
tunnel: $ID
credentials-file: $DIR/$ID.json
ingress:
  - hostname: $API_HOST
    service: http://127.0.0.1:4000
  - hostname: $MINIO_HOST
    service: http://127.0.0.1:9000
    originRequest:
      httpHostHeader: 127.0.0.1:9000
  - service: http_status:404
EOF
  echo "Wrote $CONFIG"
  echo "API:   https://$API_HOST  (Meta callback: https://$API_HOST/v1/whatsapp/webhook)"
  echo "MinIO: https://$MINIO_HOST (R2_PUBLIC_PRESIGN_BASE)"
  exit 0
fi

[ -f "$CONFIG" ] || { echo "No $CONFIG yet. Run with --setup first." >&2; exit 1; }
exec cloudflared tunnel --no-autoupdate --config "$CONFIG" run "$NAME"
