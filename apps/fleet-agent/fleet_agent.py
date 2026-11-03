#!/usr/bin/env python3
"""Aivastra fleet agent (v0): reports one GPU box's health to the Aivastra API.

Python 3 standard library only. Outbound HTTPS only: the agent opens no port and accepts no
command in this version. Everything it reads is read-only (nvidia-smi, /proc, statvfs, systemctl
show, journalctl, and ComfyUI's loopback /queue reduced to two counts). It never runs a shell,
never sends command lines, environment, paths or UUIDs, and never prints its key.

Contract: packages/types/src/fleet-agent.ts (agentTelemetrySchema). Unknown is null, never 0.
Design: docs/fleet-agent-design.md sections 4 and 5.

    fleet_agent.py --config /etc/aivastra-agent.json            run forever
    fleet_agent.py --config /etc/aivastra-agent.json --print    print one payload, send nothing
    fleet_agent.py --config /etc/aivastra-agent.json --once     collect and send one sample
"""

import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from collections import deque

VERSION = "0.2.0"
PROTOCOL = 1

KEY_RE = re.compile(r"^fa_[A-Za-z0-9_-]{43}$")
LOGICAL_RE = re.compile(r"^[a-z0-9._-]{1,32}$")
UNIT_RE = re.compile(r"^[A-Za-z0-9@._:-]{1,128}$")
PSTATE_RE = re.compile(r"^P([0-9]|1[0-5])$")
THROTTLE_RE = re.compile(r"^0x[0-9a-fA-F]{1,16}$")

GPU_QUERY = (
    "index,name,temperature.gpu,temperature.memory,fan.speed,pstate,clocks.sm,clocks.max.sm,"
    "clocks.mem,power.draw,power.limit,utilization.gpu,utilization.memory,memory.used,"
    "memory.total,clocks_throttle_reasons.active,ecc.errors.uncorrected.volatile.total,"
    "clocks_event_reasons_counters.hw_thermal_slowdown,"
    "clocks_event_reasons_counters.sw_thermal_slowdown,clocks_event_reasons_counters.sw_power_cap"
)

# A request body above this is refused by the API (413), so a sample that big is dropped locally.
MAX_BODY_BYTES = 32 * 1024
# Five minutes of samples at the default 15 s cadence; the oldest is dropped first.
SPOOL_MAX = 20
# One normal sample plus up to four from the spool per cycle stays under the API's 30/min limit.
MAX_SENDS_PER_CYCLE = 5
LOG_LINES_MAX = 40
LOG_LINE_CHARS = 300
ERROR_LINE_RE = re.compile(
    r"error|traceback|exception|out of memory|oom|failed", re.IGNORECASE
)
ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
SECRET_RE = re.compile(
    r"((?:api[_-]?key|token|secret|password|authorization)[\"']?\s*[=:]\s*)\S+", re.IGNORECASE
)


# ---- Parsing (pure; tested against recorded outputs) -----------------------------------------


def num(s):
    """A number from nvidia-smi / /proc text; None for empty, N/A, [N/A] or 'not supported'."""
    if s is None:
        return None
    t = str(s).strip()
    if not t or re.search(r"n/a|not supported|\[", t, re.IGNORECASE):
        return None
    try:
        v = float(t)
    except ValueError:
        return None
    if v != v or v in (float("inf"), float("-inf")):
        return None
    return v


def integer(s):
    v = num(s)
    return None if v is None else int(round(v))


def clean_text(s, limit):
    t = CONTROL_RE.sub(" ", ANSI_RE.sub("", s or "")).strip()
    return t[:limit] if t else None


_DRIVER_RE = re.compile(r"Kernel Module(?: for \S+)?\s+(\d{1,4}(?:\.\d{1,4}){1,3})\b")


def parse_driver_version(text):
    """NVIDIA driver version from /proc/driver/nvidia/version ("NVRM version: NVIDIA UNIX x86_64
    Kernel Module  550.127.05 ..."), or None. A file read, so it costs nothing per sample."""
    m = _DRIVER_RE.search((text or "").split("\n", 1)[0])
    return m.group(1) if m else None


def parse_gpus(text):
    gpus = []
    for line in (text or "").splitlines():
        f = [x.strip() for x in line.split(",")]
        if len(f) < 17 or not f[0].isdigit():
            continue
        f += [""] * (20 - len(f))
        gpus.append(
            {
                "index": int(f[0]),
                "name": clean_text(f[1], 120),
                "tempC": num(f[2]),
                "memTempC": num(f[3]),
                "fanPct": num(f[4]),
                "pstate": f[5] if PSTATE_RE.match(f[5]) else None,
                "smClockMhz": integer(f[6]),
                "smClockMaxMhz": integer(f[7]),
                "memClockMhz": integer(f[8]),
                "powerW": num(f[9]),
                "powerLimitW": num(f[10]),
                "utilGpuPct": num(f[11]),
                "utilMemPct": num(f[12]),
                "vramUsedMib": integer(f[13]),
                "vramTotalMib": integer(f[14]),
                "throttleReasons": f[15] if THROTTLE_RE.match(f[15]) else None,
                "eccUncorrected": integer(f[16]),
                "hwThermalSlowdownUs": integer(f[17]),
                "swThermalSlowdownUs": integer(f[18]),
                "swPowerCapUs": integer(f[19]),
            }
        )
    return gpus


def parse_compute_apps(text, gpu_count):
    """Single-GPU boxes only: a visible process belongs to GPU 0. With several GPUs the query does
    not say which, so the list is empty, which the API reads as 'not visible', not 'idle'."""
    if gpu_count != 1:
        return []
    apps = []
    for line in (text or "").splitlines()[:64]:
        mem, _, name = line.partition(",")
        if not mem.strip().isdigit():
            continue
        base = name.strip().rsplit("/", 1)[-1]
        apps.append(
            {
                "gpuIndex": 0,
                "name": clean_text(base, 80) or "unknown",
                "vramMib": integer(mem),
            }
        )
    return apps


def parse_meminfo(text):
    out = {}
    for line in (text or "").splitlines():
        m = re.match(r"^(\w+):\s+(\d+)", line)
        if m:
            out[m.group(1)] = int(round(int(m.group(2)) / 1024))
    return out


def parse_loadavg(text):
    parts = (text or "").split()
    vals = [num(p) for p in parts[:3]]
    return vals + [None] * (3 - len(vals))


def parse_psi_some10(text):
    m = re.search(r"avg10=([\d.]+)", text or "")
    return float(m.group(1)) if m else None


def parse_ntp(text):
    t = (text or "").strip()
    return True if t == "yes" else False if t == "no" else None


def parse_systemctl(text):
    kv = {}
    for line in (text or "").splitlines():
        k, _, v = line.partition("=")
        kv[k.strip()] = v.strip()
    active = kv.get("ActiveState", "")
    if active not in ("active", "inactive", "failed", "activating", "deactivating"):
        active = "unknown"
    return {
        "active": active,
        "sub": clean_text(kv.get("SubState"), 32),
        "restarts": integer(kv.get("NRestarts")),
    }


def parse_queue(text):
    """(reachable, running, pending). The body holds whole workflows, so only two counts leave."""
    try:
        d = json.loads(text)
        return True, len(d["queue_running"]), len(d["queue_pending"])
    except Exception:
        return False, None, None


def error_lines(text):
    out = []
    for raw in (text or "").splitlines():
        if not ERROR_LINE_RE.search(raw):
            continue
        line = SECRET_RE.sub(r"\1[redacted]", CONTROL_RE.sub(" ", ANSI_RE.sub("", raw))).strip()
        if line:
            out.append(line[:LOG_LINE_CHARS])
    return out[-LOG_LINES_MAX:]


def disk_entry(mount, st):
    """df semantics: usable size is used + available, so used/total matches what `df` shows."""
    gib = 1024.0**3
    used = (st.f_blocks - st.f_bfree) * st.f_frsize / gib
    avail = st.f_bavail * st.f_frsize / gib
    iused = st.f_files - st.f_ffree
    idenom = iused + st.f_favail
    return {
        "mount": mount,
        "totalGb": round(used + avail, 1),
        "usedGb": round(used, 1),
        "inodeUsedPct": round(100.0 * iused / idenom, 1) if idenom > 0 else None,
    }


# ---- The box (the only place that touches the machine; replaced in tests) ---------------------


class System:
    def run(self, argv, timeout=10):
        """Run a fixed argument list (never a shell string). None on any failure."""
        try:
            r = subprocess.run(
                argv,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=timeout,
                env={"LC_ALL": "C", "PATH": "/usr/sbin:/usr/bin:/sbin:/bin"},
            )
        except (OSError, subprocess.SubprocessError):
            return None
        return r.stdout.decode("utf-8", "replace") if r.returncode == 0 else None

    def read(self, path):
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                return fh.read()
        except OSError:
            return None

    def statvfs(self, path):
        try:
            return os.statvfs(path)
        except OSError:
            return None

    def http_get(self, url, timeout=3):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return r.read(2 * 1024 * 1024).decode("utf-8", "replace")
        except (OSError, ValueError):
            return None

    def cpu_count(self):
        return os.cpu_count()


# ---- Sample -----------------------------------------------------------------------------------


def collect(cfg, system, boot_id, seq, now_ms):
    gpu_text = system.run(["nvidia-smi", "--query-gpu=" + GPU_QUERY, "--format=csv,noheader,nounits"])
    gpus = parse_gpus(gpu_text)
    apps_text = system.run(
        ["nvidia-smi", "--query-compute-apps=used_memory,name", "--format=csv,noheader,nounits"]
    )
    mem = parse_meminfo(system.read("/proc/meminfo"))
    load = parse_loadavg(system.read("/proc/loadavg"))
    uptime = num((system.read("/proc/uptime") or "").split(" ")[0])
    swap_total = mem.get("SwapTotal")
    disks = []
    for mount in cfg["disks"]:
        st = system.statvfs(mount)
        if st is not None:
            disks.append(disk_entry(mount, st))
    services = []
    for logical, unit in cfg["units"].items():
        s = parse_systemctl(
            system.run(["systemctl", "show", "-p", "ActiveState", "-p", "SubState", "-p", "NRestarts", unit])
        )
        s["name"] = logical
        services.append(s)
    comfy = []
    for inst in cfg["comfy"]:
        ok, running, pending = parse_queue(
            system.http_get("http://127.0.0.1:%d/queue" % inst["port"]) or ""
        )
        comfy.append(
            {"instance": inst["instance"], "reachable": ok, "running": running, "pending": pending}
        )
    payload = {
        "v": PROTOCOL,
        "workerId": cfg["workerId"],
        "agentVersion": VERSION,
        "bootId": boot_id,
        "seq": seq,
        "observedAt": now_ms,
        "gpus": gpus,
        "computeApps": parse_compute_apps(apps_text, len(gpus)),
        "host": {
            "cpuCount": system.cpu_count(),
            "load1": load[0],
            "load5": load[1],
            "load15": load[2],
            "ramTotalMib": mem.get("MemTotal"),
            "ramAvailMib": mem.get("MemAvailable"),
            "swapTotalMib": swap_total,
            "swapUsedMib": None if swap_total is None else swap_total - mem.get("SwapFree", swap_total),
            "memPsiSome10": parse_psi_some10(system.read("/proc/pressure/memory")),
            "uptimeSec": None if uptime is None else int(uptime),
            "ntpSynced": parse_ntp(system.run(["timedatectl", "show", "-p", "NTPSynchronized", "--value"])),
            "driverVersion": parse_driver_version(system.read("/proc/driver/nvidia/version")),
            "disks": disks,
        },
        "services": services,
        "comfy": comfy,
    }
    if cfg["logs"]:
        unit = cfg["units"].get(cfg["logs"]["unit"])
        text = unit and system.run(
            ["journalctl", "-u", unit, "--since", "%d min ago" % cfg["logs"]["windowMinutes"], "--no-pager", "-o", "cat"],
            timeout=8,
        )
        lines = error_lines(text)
        if lines:
            payload["logs"] = [{"unit": cfg["logs"]["unit"], "lines": lines}]
    return payload


# ---- Sending ----------------------------------------------------------------------------------


def post(url, key, body, timeout=10):
    """(status, parsed JSON or None). status 0 means the request never got an answer."""
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "User-Agent": "aivastra-fleet-agent/" + VERSION,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            status, raw = r.status, r.read(64 * 1024)
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read(64 * 1024)
    except (OSError, ValueError):
        return 0, None
    try:
        return status, json.loads(raw.decode("utf-8", "replace"))
    except ValueError:
        return status, None


def error_code(body):
    err = body.get("error") if isinstance(body, dict) else None
    return err.get("code") if isinstance(err, dict) and isinstance(err.get("code"), str) else None


# What each answer means for the sample that was just sent.
#   sent     - accepted (a duplicate also counts: the API already has it)
#   drop     - the API will never accept this exact sample; retrying cannot help
#   keep     - not the sample's fault (auth, rate limit, outage); keep it and try later
def classify(status):
    if status == 200:
        return "sent"
    if status in (400, 413, 422):
        return "drop"
    return "keep"


def flush(spool, send, log, max_sends=MAX_SENDS_PER_CYCLE):
    """Send the oldest samples first. Stops at the first answer that is not 'sent' or 'drop'."""
    sent = 0
    for _ in range(max_sends):
        if not spool:
            break
        payload = spool[0]
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        if len(body) > MAX_BODY_BYTES:
            spool.popleft()
            log("dropped seq %s: %d bytes is over the %d limit" % (payload["seq"], len(body), MAX_BODY_BYTES))
            continue
        status, answer = send(body)
        verdict = classify(status)
        if verdict == "sent":
            spool.popleft()
            sent += 1
        elif verdict == "drop":
            spool.popleft()
            log("dropped seq %s: API said %d %s" % (payload["seq"], status, error_code(answer) or ""))
        else:
            log(
                "keeping %d sample(s): %s"
                % (len(spool), "no answer" if status == 0 else "API said %d %s" % (status, error_code(answer) or ""))
            )
            break
    return sent


# ---- Config -----------------------------------------------------------------------------------


class ConfigError(Exception):
    pass


def load_config(path, read_key=True):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, ValueError) as e:
        raise ConfigError("cannot read config %s: %s" % (path, e))
    if not isinstance(raw, dict):
        raise ConfigError("config must be a JSON object")
    worker = raw.get("workerId")
    if not isinstance(worker, str) or not 1 <= len(worker) <= 100:
        raise ConfigError("workerId is required")
    url = raw.get("ingestUrl")
    if not isinstance(url, str):
        raise ConfigError("ingestUrl is required")
    loopback = re.match(r"^http://(127\.0\.0\.1|localhost)(:\d+)?/", url)
    if not (url.startswith("https://") or loopback):
        raise ConfigError("ingestUrl must be https:// (plain http only for 127.0.0.1)")
    units = raw.get("units") or {"comfyui": "comfyui"}
    if not isinstance(units, dict) or not units or len(units) > 16:
        raise ConfigError("units must map logical names to systemd unit names")
    for logical, unit in units.items():
        if not LOGICAL_RE.match(logical) or not isinstance(unit, str) or not UNIT_RE.match(unit):
            raise ConfigError("bad unit entry %r" % (logical,))
    comfy = raw.get("comfy") or [{"instance": "main", "port": 8188}]
    for inst in comfy:
        if not (isinstance(inst, dict) and LOGICAL_RE.match(str(inst.get("instance", "")))
                and isinstance(inst.get("port"), int) and 1 <= inst["port"] <= 65535):
            raise ConfigError("bad comfy entry %r" % (inst,))
    logs = raw.get("logs", {"unit": "comfyui", "windowMinutes": 30})
    if logs:
        if logs.get("unit") not in units or not isinstance(logs.get("windowMinutes"), int) \
                or not 1 <= logs["windowMinutes"] <= 240:
            raise ConfigError("logs.unit must be one of units, windowMinutes 1..240")
    interval = raw.get("intervalSec", 15)
    if not isinstance(interval, (int, float)) or not 5 <= interval <= 300:
        raise ConfigError("intervalSec must be 5..300")
    key = ""
    if read_key:
        key_file = raw.get("keyFile")
        if not isinstance(key_file, str):
            raise ConfigError("keyFile is required")
        try:
            mode = os.stat(key_file).st_mode & 0o077
            with open(key_file, "r", encoding="utf-8") as fh:
                key = fh.read().strip()
        except OSError as e:
            raise ConfigError("cannot read keyFile: %s" % e.strerror)
        if mode:
            raise ConfigError("keyFile must not be readable by group or others (chmod 600)")
        if not KEY_RE.match(key):
            raise ConfigError("keyFile does not hold a fleet agent key")
    return {
        "workerId": worker,
        "ingestUrl": url,
        "key": key,
        "units": units,
        "comfy": comfy,
        "logs": logs or None,
        "disks": raw.get("disks") or ["/"],
        "intervalSec": interval,
    }


# ---- Main loop --------------------------------------------------------------------------------


def make_logger():
    def log(msg):
        # stdout goes to the journal; the key is never in any message.
        print("fleet-agent: " + msg, flush=True)

    return log


def run(cfg, system=None, sender=None, clock=time.time, sleep=time.sleep, stop=lambda: False, cycles=None):
    system = system or System()
    log = make_logger()
    boot_id = str(uuid.uuid4())
    seq = 0
    spool = deque(maxlen=SPOOL_MAX)
    send = sender or (lambda body: post(cfg["ingestUrl"], cfg["key"], body))
    log("started v%s boot %s worker %s" % (VERSION, boot_id, cfg["workerId"]))
    done = 0
    while not stop() and (cycles is None or done < cycles):
        started = clock()
        try:
            spool.append(collect(cfg, system, boot_id, seq, int(started * 1000)))
            seq += 1
        except Exception as e:  # a bad read must never end the agent
            log("collect failed: %s" % type(e).__name__)
        try:
            flush(spool, send, log)
        except Exception as e:
            log("send failed: %s" % type(e).__name__)
        done += 1
        sleep(max(0.0, cfg["intervalSec"] - (clock() - started)))
    log("stopping with %d unsent sample(s)" % len(spool))
    return spool


def main(argv):
    args = argv[1:]
    if "--config" not in args or args.index("--config") + 1 >= len(args):
        print(__doc__)
        return 2
    path = args[args.index("--config") + 1]
    printing = "--print" in args
    try:
        cfg = load_config(path, read_key=not printing)
    except ConfigError as e:
        print("fleet-agent: config error: %s" % e, file=sys.stderr)
        return 2
    if printing:
        print(json.dumps(collect(cfg, System(), str(uuid.uuid4()), 0, int(time.time() * 1000)), indent=2))
        return 0
    stopping = {"now": False}

    def handle(_sig, _frame):
        stopping["now"] = True

    signal.signal(signal.SIGTERM, handle)
    signal.signal(signal.SIGINT, handle)
    run(cfg, stop=lambda: stopping["now"], cycles=1 if "--once" in args else None)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
