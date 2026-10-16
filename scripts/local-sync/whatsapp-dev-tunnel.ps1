# Fixed public URLs for testing the WhatsApp bot against a local stack.
#
# Meta must reach two local things: the api (webhook) and MinIO (carousel images,
# which Meta downloads by link). A cloudflared *quick* tunnel gives a new random
# URL on every start, which means re-pointing Meta's callback and .env each time.
# A *named* tunnel keeps the same hostnames for good.
#
# One-time setup (opens a browser to pick the Cloudflare zone, aivastra.com):
#   powershell -ExecutionPolicy Bypass -File scripts\local-sync\whatsapp-dev-tunnel.ps1 -Setup
# Every session after that:
#   powershell -ExecutionPolicy Bypass -File scripts\local-sync\whatsapp-dev-tunnel.ps1
#
# Then, once:
#   .env: R2_PUBLIC_PRESIGN_BASE=https://<MinioHost>
#   Meta callback URL: https://<ApiHost>/v1/whatsapp/webhook
# When you stop testing, put R2_PUBLIC_PRESIGN_BASE back to http://127.0.0.1:9000.
#
# Each developer uses their own -Name and hostnames, so two machines never fight
# over one tunnel. Nothing here is a secret: the tunnel credentials file lives in
# ~/.cloudflared and never in the repo.
param(
  [switch]$Setup,
  [string]$Name = 'aivastra-wa-dev',
  [string]$ApiHost = 'wa-dev-api.aivastra.com',
  [string]$MinioHost = 'wa-dev-minio.aivastra.com'
)
$ErrorActionPreference = 'Stop'
$cf = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$dir = Join-Path $HOME '.cloudflared'
$config = Join-Path $dir "$Name.yml"

if ($Setup) {
  if (-not (Test-Path (Join-Path $dir 'cert.pem'))) { & $cf tunnel login }
  # Parenthesised: Windows PowerShell 5.1's ConvertFrom-Json emits the whole JSON
  # array as ONE pipeline item, so an unwrapped Where-Object sees every tunnel at
  # once and .id returns all their ids.
  $find = { (& $cf tunnel list --output json | ConvertFrom-Json) | Where-Object { $_.name -eq $Name } }
  if (-not (& $find)) { & $cf tunnel create $Name | Out-Host }
  $id = @(& $find)[0].id
  & $cf tunnel route dns $Name $ApiHost | Out-Host
  & $cf tunnel route dns $Name $MinioHost | Out-Host
  # MinIO's presigned signatures cover the Host header, and URLs are signed for
  # 127.0.0.1:9000 locally; rewriting Host keeps them valid through the tunnel.
  @"
tunnel: $id
credentials-file: $dir\$id.json
ingress:
  - hostname: $ApiHost
    service: http://127.0.0.1:4000
  - hostname: $MinioHost
    service: http://127.0.0.1:9000
    originRequest:
      httpHostHeader: 127.0.0.1:9000
  - service: http_status:404
"@ | Set-Content -Encoding ascii $config
  Write-Output "Wrote $config"
  Write-Output "API:   https://$ApiHost  (Meta callback: https://$ApiHost/v1/whatsapp/webhook)"
  Write-Output "MinIO: https://$MinioHost (R2_PUBLIC_PRESIGN_BASE)"
  exit 0
}

if (-not (Test-Path $config)) { throw "No $config yet. Run with -Setup first." }
& $cf tunnel --no-autoupdate --config $config run $Name
