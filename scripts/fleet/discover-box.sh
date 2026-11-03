#!/usr/bin/env bash
#
# Read-only discovery of one GPU box, to size the fleet agent before anything is installed.
#
# CHANGES NOTHING: no installs, no writes outside the one report file, no service or firewall
# changes. It sends two HTTPS requests (HEAD) to test outbound reachability and nothing else
# leaves the box. By default it does not use sudo (it only asks `sudo -n true` whether sudo
# would work). Without root, `ss` cannot name processes owned by other users, so the process
# that holds ports 80/443/8443 may show as blank; set USE_SUDO=1 to run just the read-only
# `ss -ltnp` and `systemctl show` through passwordless sudo.
#
# Deliberately NOT collected, because they can carry secrets: environment variables, process
# command lines, systemd unit files / ExecStart lines, GPU UUIDs and serials, SSH keys, logs.
# A redaction pass over the whole report is a backstop, not the primary protection. Read the
# report before you share it.
#
# Usage (on the box, as the user that runs ComfyUI):
#   bash discover-box.sh                    # writes ./fleet-discovery-<host>-<utc>.txt
#   API_URL=https://staging-app.example bash discover-box.sh
#   OUT=/tmp/report.txt bash discover-box.sh
#   USE_SUDO=1 bash discover-box.sh         # name the process behind each listening port
#
set -u

API_URL="${API_URL:-https://app.aivastra.com}"
USE_SUDO="${USE_SUDO:-0}"
HOST_SHORT="$(hostname -s 2>/dev/null || echo box)"
OUT="${OUT:-./fleet-discovery-${HOST_SHORT}-$(date -u +%Y%m%dT%H%M%SZ).txt}"

# Every command is time-boxed so a hung driver or a dead mount cannot hang the script.
if command -v timeout >/dev/null 2>&1; then
  t() { timeout 10 "$@" 2>&1; }
else
  t() { "$@" 2>&1; }
fi
have() { command -v "$1" >/dev/null 2>&1; }
# Read-only privileged calls only, and only when the operator asked for them.
priv() {
  if [ "$USE_SUDO" = "1" ] && have sudo && sudo -n true >/dev/null 2>&1; then
    t sudo -n "$@"
  else
    t "$@"
  fi
}
section() { printf '\n===== %s =====\n' "$1"; }
kv() { printf '%-28s %s\n' "$1" "$2"; }

report() {
  printf 'aivastra fleet discovery v1\n'
  printf 'generated_utc  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'generated_epoch %s   (compare with your workstation: `date -u +%%s`)\n' "$(date -u +%s)"

  section "1. identity"
  kv hostname "$(hostname 2>/dev/null)"
  kv kernel "$(uname -srm 2>/dev/null)"
  kv os "$( (. /etc/os-release 2>/dev/null && printf '%s' "${PRETTY_NAME:-unknown}") || echo unknown)"
  virt="$(have systemd-detect-virt && t systemd-detect-virt)"
  kv virtualization "${virt:-unknown}"
  kv uptime "$(uptime -p 2>/dev/null || echo unknown)"
  kv cpus "$(nproc 2>/dev/null || echo unknown)"
  kv user "$(id -un 2>/dev/null)"
  kv groups "$(id -Gn 2>/dev/null)"
  if have timedatectl; then
    kv ntp_synchronized "$(t timedatectl show -p NTPSynchronized --value)"
    kv timezone "$(t timedatectl show -p Timezone --value)"
  fi

  section "2. privileges and init system"
  [ -d /run/systemd/system ] && kv systemd yes || kv systemd no
  if have sudo; then
    if sudo -n true >/dev/null 2>&1; then kv sudo_no_prompt yes; else kv sudo_no_prompt no; fi
  else
    kv sudo_no_prompt "no (sudo not installed)"
  fi
  kv journal_readable_by_this_user "$(t journalctl -n 1 --no-pager -q >/dev/null 2>&1 && echo yes || echo no)"

  section "3. tools the agent could rely on"
  for c in python3 curl wget jq nvidia-smi systemctl journalctl ss docker; do
    if have "$c"; then kv "$c" "$(command -v "$c")"; else kv "$c" "MISSING"; fi
  done
  if have python3; then
    kv python_version "$(t python3 --version)"
    kv python_stdlib_https "$(t python3 -c 'import ssl, json, urllib.request, subprocess, shutil, os; print("ok, " + ssl.OPENSSL_VERSION)')"
    kv python_psutil "$(t python3 -c 'import psutil; print(psutil.__version__)' | tail -1)"
  fi

  section "4. GPU (nvidia-smi)"
  if have nvidia-smi; then
    t nvidia-smi -L | sed -E 's/ \(UUID: [^)]*\)//'
    kv driver "$(t nvidia-smi --query-gpu=driver_version --format=csv,noheader | sort -u | tr '\n' ' ')"
    printf '\n-- per-field support, one query each (N/A or [Not Supported] = unusable on this box) --\n'
    for f in name pstate temperature.gpu temperature.memory fan.speed power.draw power.limit \
             enforced.power.limit clocks.sm clocks.max.sm clocks.mem clocks.max.mem clocks.gr \
             utilization.gpu utilization.memory memory.used memory.total memory.free \
             clocks_throttle_reasons.active clocks_event_reasons.active \
             ecc.errors.uncorrected.volatile.total compute_mode mig.mode.current persistence_mode count; do
      out="$(t nvidia-smi --query-gpu="index,$f" --format=csv,noheader 2>&1 | tr '\n' ';')"
      printf '%-44s %s\n' "$f" "$out"
    done
    printf '\n-- compute processes (name and VRAM only; empty can mean none, or not visible from a shared pod/VM) --\n'
    t nvidia-smi --query-compute-apps=gpu_bus_id,pid,used_memory,process_name --format=csv,noheader | head -20
    printf '\n-- clock event reasons as nvidia-smi -q reports them --\n'
    t nvidia-smi -q -d PERFORMANCE | grep -Ei 'event reasons|throttle|active|slowdown|power cap|thermal|sync boost' | head -20
  else
    echo "nvidia-smi not found on PATH"
  fi

  section "5. ComfyUI and related processes (names only, no command lines)"
  ps -eo pid,user,etimes,comm 2>/dev/null | grep -Ei 'python|comfy|uvicorn|gunicorn|nginx|caddy|cloudflared|tunnel|exporter|alloy|dockerd' | grep -v grep | head -40
  printf '\n-- HTTP status only from localhost ports that commonly serve ComfyUI (no body, no auth) --\n'
  for p in 8188 8189 8190 7071 7072 8000 8080; do
    code="$(t curl -s -m 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${p}/system_stats")"
    printf 'port %-5s /system_stats -> %s\n' "$p" "$code"
  done

  section "6. services that matter (state only, never the unit file)"
  if have systemctl; then
    units="$(t systemctl list-units --type=service --all --no-legend --no-pager | awk '{print $1}' | grep -Ei 'comfy|classify|cloudflared|tunnel|nginx|caddy|auth|node_exporter|dcgm|alloy|prometheus|docker|fleet|aivastra' | sort -u)"
    if [ -z "$units" ]; then echo "(no matching units)"; fi
    for u in $units; do
      echo "--- $u"
      priv systemctl show "$u" -p ActiveState -p SubState -p User -p WorkingDirectory -p Restart -p NRestarts -p MemoryMax --no-pager
    done
  else
    echo "systemctl not available"
  fi

  section "7. listening TCP sockets (address and owning process name; blank name = owned by another user, rerun with USE_SUDO=1)"
  if have ss; then
    priv ss -ltnpH | sed -E 's/fd=[0-9]+//g; s/users:\(\("([^"]*)",pid=([0-9]+),?\)\)/\1 pid=\2/' | head -40
  else
    echo "ss not available"
  fi

  section "8. storage"
  t df -hT -x tmpfs -x devtmpfs -x squashfs -x overlay | head -20
  printf '\n-- inodes --\n'
  t df -i -x tmpfs -x devtmpfs -x squashfs -x overlay | head -20
  printf '\n-- block devices (no serials) --\n'
  t lsblk -e7 -o NAME,SIZE,TYPE,MOUNTPOINT | head -30
  kv opt_exists_and_writable "$([ -d /opt ] && [ -w /opt ] && echo yes || echo no)"

  section "9. memory"
  t free -m
  printf '\n-- swap --\n'
  t swapon --show
  kv swappiness "$(cat /proc/sys/vm/swappiness 2>/dev/null)"
  [ -r /proc/pressure/memory ] && { printf '\n-- memory pressure (PSI) --\n'; cat /proc/pressure/memory; }

  section "10. outbound reachability (HEAD requests only)"
  kv https_proxy_env_set "$([ -n "${HTTPS_PROXY:-${https_proxy:-}}" ] && echo yes || echo no)"
  host="${API_URL#*://}"; host="${host%%/*}"
  kv dns_for_api "$(t getent hosts "$host" | head -1)"
  if have curl; then
    printf '%-28s %s\n' "api ($API_URL)" "$(t curl -sS -m 8 -I -o /dev/null -w 'http=%{http_code} connect=%{time_connect}s total=%{time_total}s' "$API_URL/")"
    printf '%-28s %s\n' "internet (1.1.1.1)" "$(t curl -sS -m 8 -I -o /dev/null -w 'http=%{http_code} total=%{time_total}s' https://1.1.1.1/)"
  else
    echo "curl missing; skipped"
  fi

  section "11. containers"
  if have docker; then
    t docker ps --format '{{.Names}}  {{.Image}}  {{.Status}}' | head -20
  else
    echo "docker not installed"
  fi

  section "12. what to send back"
  echo "This file. Check it first: it should contain no keys or tokens. If anything looks sensitive, delete that line."
}

report 2>&1 \
  | sed -E 's/((api[_-]?key|token|secret|passw(or)?d|authorization|bearer|credential)[A-Za-z_]*[=: ]+)[^ ;]+/\1<redacted>/Ig' \
  | tee "$OUT"

printf '\nwritten to %s\n' "$OUT" >&2
