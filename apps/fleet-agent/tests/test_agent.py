import json, os, sys, tempfile, unittest
from collections import deque
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import fleet_agent as a

FX = os.path.join(os.path.dirname(__file__), "..", "fixtures", "w7")
def fx(n):
    with open(os.path.join(FX, n)) as f: return f.read()

class FakeSystem:
    def __init__(self, queue='{"queue_running":[],"queue_pending":[[1],[2]]}'):
        self.queue = queue
    def run(self, argv, timeout=10):
        if argv[0] == "nvidia-smi":
            return fx("gpu.csv") if "--query-gpu" in argv[1] else fx("apps.csv")
        if argv[0] == "systemctl": return fx("systemctl_comfyui")
        if argv[0] == "timedatectl": return fx("ntp")
        if argv[0] == "journalctl": return "ok line\nRuntimeError: boom token=abc123\n"
        return None
    def read(self, p):
        return {"/proc/meminfo": fx("meminfo"), "/proc/loadavg": fx("loadavg"),
                "/proc/pressure/memory": fx("pressure_memory"), "/proc/uptime": fx("uptime")}.get(p)
    def statvfs(self, p): return os.statvfs("/")
    def http_get(self, url, timeout=3): return self.queue
    def cpu_count(self): return 16

CFG = {"workerId": "woker-7", "ingestUrl": "https://x/v1/fleet/agent/ingest", "key": "k",
       "units": {"comfyui": "comfyui-main"}, "comfy": [{"instance": "main", "port": 8339}],
       "logs": {"unit": "comfyui", "windowMinutes": 30}, "disks": ["/"], "intervalSec": 15}

class Parse(unittest.TestCase):
    def test_gpu_na_is_null(self):
        g = a.parse_gpus(fx("gpu.csv"))[0]
        self.assertEqual(g["index"], 0); self.assertEqual(g["tempC"], 32.0)
        self.assertIsNone(g["memTempC"]); self.assertIsNone(g["fanPct"])
        self.assertEqual(g["smClockMhz"], 2370); self.assertEqual(g["vramTotalMib"], 97887)
        self.assertEqual(g["throttleReasons"], "0x0000000000000000")
        self.assertEqual(g["hwThermalSlowdownUs"], 5213071)
    def test_apps_basename_only(self):
        apps = a.parse_compute_apps(fx("apps.csv"), 1)
        self.assertEqual(apps, [{"gpuIndex": 0, "name": "python3", "vramMib": 37578}])
    def test_apps_hidden_with_many_gpus(self):
        self.assertEqual(a.parse_compute_apps(fx("apps.csv"), 2), [])
    def test_empty_inputs(self):
        self.assertEqual(a.parse_gpus(""), []); self.assertEqual(a.parse_gpus(None), [])
    def test_mem_psi_load(self):
        m = a.parse_meminfo(fx("meminfo")); self.assertEqual(m["SwapTotal"], 0)
        self.assertEqual(a.parse_psi_some10(fx("pressure_memory")), 0.0)
        self.assertEqual(a.parse_loadavg(fx("loadavg"))[:2], [0.66, 0.5])
    def test_systemctl(self):
        self.assertEqual(a.parse_systemctl(fx("systemctl_comfyui")),
                         {"active": "active", "sub": "running", "restarts": 0})
        self.assertEqual(a.parse_systemctl(None)["active"], "unknown")
    def test_queue(self):
        self.assertEqual(a.parse_queue('{"queue_running":[[1]],"queue_pending":[]}'), (True, 1, 0))
        self.assertEqual(a.parse_queue("garbage"), (False, None, None))
    def test_error_lines_redact(self):
        out = a.error_lines("fine\n\x1b[31mError: token=abc\x1b[0m\n")
        self.assertEqual(out, ["Error: token=[redacted]"])
    def test_ntp(self):
        self.assertTrue(a.parse_ntp("yes")); self.assertIsNone(a.parse_ntp(""))

class Collect(unittest.TestCase):
    def test_payload_shape(self):
        p = a.collect(CFG, FakeSystem(), "11111111-2222", 3, 1_700_000_000_000)
        self.assertEqual(p["v"], 1); self.assertEqual(p["seq"], 3)
        self.assertEqual(p["host"]["swapUsedMib"], 0); self.assertEqual(p["host"]["uptimeSec"], 2941463)
        self.assertEqual(p["comfy"][0], {"instance": "main", "reachable": True, "running": 0, "pending": 2})
        self.assertEqual(p["services"][0]["name"], "comfyui")
        self.assertEqual(p["logs"][0]["lines"], ["RuntimeError: boom token=[redacted]"])
        self.assertLess(len(json.dumps(p)), a.MAX_BODY_BYTES)
    def test_unreachable_comfy(self):
        p = a.collect(CFG, FakeSystem(queue=None), "11111111-2222", 0, 1)
        self.assertEqual(p["comfy"][0], {"instance": "main", "reachable": False, "running": None, "pending": None})
    def test_key_never_in_payload(self):
        self.assertNotIn(CFG["key"] + '"', json.dumps(a.collect(CFG, FakeSystem(), "11111111-2222", 0, 1)))

class Flush(unittest.TestCase):
    def mk(self, n): return deque({"seq": i} for i in range(n))
    def test_sent_and_drop_and_keep(self):
        for status, left in ((200, 0), (422, 0), (401, 2), (429, 2), (503, 2), (0, 2)):
            sp = self.mk(2); logs = []
            a.flush(sp, lambda b, s=status: (s, None), logs.append, max_sends=1 if left else 5)
            self.assertEqual(len(sp), left if left == 2 else 0, status)
    def test_oldest_first_and_stop_on_failure(self):
        sp = self.mk(3); seen = []
        def send(b):
            seen.append(json.loads(b)["seq"]); return (200, None) if len(seen) < 3 else (503, None)
        a.flush(sp, send, lambda m: None)
        self.assertEqual(seen, [0, 1, 2]); self.assertEqual([x["seq"] for x in sp], [2])
    def test_cap_per_cycle(self):
        sp = self.mk(10); self.assertEqual(a.flush(sp, lambda b: (200, None), lambda m: None), 5)
    def test_oversize_dropped_without_sending(self):
        sp = deque([{"seq": 1, "x": "a" * 40000}]); called = []
        a.flush(sp, lambda b: called.append(1) or (200, None), lambda m: None)
        self.assertFalse(called); self.assertEqual(len(sp), 0)

class Run(unittest.TestCase):
    def test_spools_while_down_then_flushes(self):
        up = {"v": False}; got = []
        def send(b):
            if not up["v"]: return 0, None
            got.append(json.loads(b)["seq"]); return 200, None
        t = {"n": 0}
        def sleep(_):
            t["n"] += 1
            if t["n"] == 3: up["v"] = True
        a.run(CFG, FakeSystem(), send, clock=lambda: 1000.0, sleep=sleep, cycles=4)
        self.assertEqual(got, [0, 1, 2, 3])
    def test_spool_bounded(self):
        sp = a.run(CFG, FakeSystem(), lambda b: (0, None), clock=lambda: 1.0, sleep=lambda s: None, cycles=30)
        self.assertEqual(len(sp), a.SPOOL_MAX)
        self.assertEqual(sp[-1]["seq"], 29)
    def test_collect_failure_does_not_end_loop(self):
        class Bad(FakeSystem):
            def read(self, p): raise RuntimeError("x")
        a.run(CFG, Bad(), lambda b: (200, None), clock=lambda: 1.0, sleep=lambda s: None, cycles=2)

class Config(unittest.TestCase):
    def write(self, d, key_mode=0o600, **over):
        kf = os.path.join(d, "key"); open(kf, "w").write("fa_" + "A" * 43); os.chmod(kf, key_mode)
        c = {"workerId": "w", "ingestUrl": "https://h/v1/fleet/agent/ingest", "keyFile": kf}; c.update(over)
        p = os.path.join(d, "c.json"); json.dump(c, open(p, "w")); return p
    def test_ok_defaults(self):
        with tempfile.TemporaryDirectory() as d:
            c = a.load_config(self.write(d)); self.assertEqual(c["units"], {"comfyui": "comfyui"})
    def test_rejects(self):
        with tempfile.TemporaryDirectory() as d:
            for over in ({"ingestUrl": "http://example.com/x"}, {"units": {"Bad Name": "u"}},
                         {"units": {"comfyui": "a b; rm"}}, {"intervalSec": 1},
                         {"comfy": [{"instance": "m", "port": 0}]}):
                with self.assertRaises(a.ConfigError, msg=str(over)): a.load_config(self.write(d, **over))
            with self.assertRaises(a.ConfigError): a.load_config(self.write(d, key_mode=0o644))
    def test_loopback_http_allowed(self):
        with tempfile.TemporaryDirectory() as d:
            a.load_config(self.write(d, ingestUrl="http://127.0.0.1:4000/v1/fleet/agent/ingest"))

if __name__ == "__main__": unittest.main()
