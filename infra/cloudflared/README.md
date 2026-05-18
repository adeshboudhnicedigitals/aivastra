# Cloudflare Tunnel Setup (Worker VPS)

Each ComfyUI GPU VPS exposes `localhost:8188` to the dispatcher through a named tunnel. No inbound ports are opened on the VPS.

## Per-worker steps

```bash
# 1. Install
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# 2. Auth (opens browser on dev machine; copy cert.pem to VPS if headless)
cloudflared tunnel login

# 3. Create tunnel (per VPS — name uniquely: tryon-worker-a, tryon-worker-b, ...)
cloudflared tunnel create tryon-worker-a
# → prints UUID and credentials JSON path

# 4. Route DNS
cloudflared tunnel route dns tryon-worker-a worker-a.tryon.yourdomain.com

# 5. Copy config.example.yml → ~/.cloudflared/config.yml, fill UUID + hostname

# 6. Install as service
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

## Cloudflare Access (Zero Trust) — done once in dashboard

1. Zero Trust → Access → Applications → Add → Self-hosted
2. Application domain: `worker-*.tryon.yourdomain.com` (wildcard)
3. Policy: Service Token → create token, save `Client-Id` + `Client-Secret`
4. Put those into `.env` as `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` on the dispatcher host

The dispatcher sends those headers on every `/prompt` and `/system_stats` call.
