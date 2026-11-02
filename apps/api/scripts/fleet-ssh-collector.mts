// LOCAL DEV ONLY. Collects REAL telemetry from the GPU boxes over SSH and feeds it to the LOCAL
// API through the real ingest endpoint, so the local gpu-ops dashboard shows live analytics of the
// real fleet. Nothing is installed on the boxes and nothing leaves this machine.
//
//   pnpm --filter @aivastra/api fleet:collect              stream until Ctrl-C
//   pnpm --filter @aivastra/api fleet:collect -- --once    one round, then exit
//   pnpm --filter @aivastra/api fleet:collect -- --cleanup remove its keys and the telemetry it stored
//
// What it runs on each box is a fixed, read-only probe (no sudo, nothing written): nvidia-smi
// queries, /proc reads, df, systemctl is-active, and a loopback GET of ComfyUI's /queue reduced to
// two counts on the box (the queue body holds whole workflows and never leaves it). It reads the
// ssh aliases w1..w7 from ~/.ssh/config. w8 is deliberately not included.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, schema, sql } from '@aivastra/db';
import type { AgentTelemetry } from '@aivastra/types';
import { generateAgentKey } from '../src/modules/fleet/agent-keys.js';
import { runFleetRollupTick } from '../src/modules/fleet/rollups.js';

const API = process.env.FLEET_COLLECT_API ?? 'http://127.0.0.1:4000';
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const isLocal = (u: string) =>
  /^(https?:\/\/|postgres(ql)?:\/\/[^@]*@)(127\.0\.0\.1|localhost)([:/]|$)/.test(u);
if (!isLocal(API) || !isLocal(DATABASE_URL)) {
  console.error('refusing to run: FLEET_COLLECT_API and DATABASE_URL must point at this machine');
  process.exit(1);
}

type Box = { alias: string; port: number; comfyUnit: string };
// Ports and unit names are from the discovery reports and the operator's notes (w5 serves ComfyUI
// on 7070; everything else on 8339).
const BOXES: Box[] = [
  { alias: 'w1', port: 8339, comfyUnit: 'comfyui' },
  { alias: 'w2', port: 8339, comfyUnit: 'comfyui' },
  { alias: 'w3', port: 8339, comfyUnit: 'comfyui' },
  { alias: 'w4', port: 8339, comfyUnit: 'comfyui' },
  { alias: 'w5', port: 7070, comfyUnit: 'comfyui-7070' },
  { alias: 'w6', port: 8339, comfyUnit: 'comfyui-main' },
  { alias: 'w7', port: 8339, comfyUnit: 'comfyui-main' },
];
const STEP_MS = 15_000;
// The collector attaches telemetry to the REAL worker rows (imported from production with
// fleet-import-workers.mts); it never creates or deletes a worker.
const WORKER_IDS: Record<string, string> = {
  w1: 'worker-1',
  w2: 'worker-2',
  w3: 'worker-3',
  w4: 'tryon-worker-4',
  w5: 'worker-5',
  w6: 'tryon-worker-6',
  w7: 'woker-7',
};
const workerIdOf = (b: Box) => WORKER_IDS[b.alias] as string;

// The whole remote program. Output is a flat "SECTION" format parsed below. Every command is
// read-only and bounded by a timeout.
const REMOTE = String.raw`
export LC_ALL=C
echo "@gpu"
timeout 10 nvidia-smi --query-gpu=index,name,temperature.gpu,temperature.memory,fan.speed,pstate,clocks.sm,clocks.max.sm,clocks.mem,power.draw,power.limit,utilization.gpu,utilization.memory,memory.used,memory.total,clocks_throttle_reasons.active,ecc.errors.uncorrected.volatile.total --format=csv,noheader,nounits 2>/dev/null
echo "@apps"
timeout 10 nvidia-smi --query-compute-apps=used_memory,name --format=csv,noheader,nounits 2>/dev/null
echo "@load"; cat /proc/loadavg
echo "@cpus"; nproc
echo "@mem"; grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo
echo "@psi"; cat /proc/pressure/memory 2>/dev/null | head -1
echo "@uptime"; cut -d' ' -f1 /proc/uptime
echo "@ntp"; timedatectl show -p NTPSynchronized --value 2>/dev/null
echo "@df"; df -P -BG / | tail -1
echo "@dfi"; df -P -i / | tail -1
echo "@svc"
for u in "$1" comfyui-auth nginx; do echo "$u $(systemctl is-active "$u" 2>/dev/null) $(systemctl show -p NRestarts --value "$u" 2>/dev/null)"; done
echo "@queue"
curl -s -m 3 "http://127.0.0.1:$2/queue" 2>/dev/null | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin); print(len(d["queue_running"]), len(d["queue_pending"]))
except Exception:
  print("error")'
`;

const CTRL = join(tmpdir(), 'fleet-collect-%C');
function ssh(box: Box): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=8',
        '-o',
        'ServerAliveInterval=5',
        '-o',
        'ControlMaster=auto',
        '-o',
        `ControlPath=${CTRL}`,
        '-o',
        'ControlPersist=120',
        box.alias,
        'bash',
        '-s',
        '--',
        box.comfyUnit,
        String(box.port),
      ],
      { timeout: 25_000, maxBuffer: 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
    child.stdin?.end(REMOTE);
  });
}

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const t = s.trim();
  if (!t || /n\/a|not supported|\[/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const int = (s: string | undefined) => {
  const n = num(s);
  return n === null ? null : Math.round(n);
};

function sections(out: string): Record<string, string[]> {
  const res: Record<string, string[]> = {};
  let cur = '';
  for (const line of out.split('\n')) {
    if (line.startsWith('@')) {
      cur = line.slice(1).trim();
      res[cur] = [];
    } else if (cur && line.trim()) res[cur]?.push(line.trim());
  }
  return res;
}

function parse(box: Box, out: string, bootId: string, seq: number): AgentTelemetry {
  const s = sections(out);
  const gpus = (s.gpu ?? []).map((line) => {
    const f = line.split(',').map((x) => x.trim());
    const reasons = f[15] ?? '';
    return {
      index: Number(f[0]),
      name: f[1] || null,
      tempC: num(f[2]),
      memTempC: num(f[3]),
      fanPct: num(f[4]),
      pstate: /^P([0-9]|1[0-5])$/.test(f[5] ?? '') ? (f[5] as string) : null,
      smClockMhz: int(f[6]),
      smClockMaxMhz: int(f[7]),
      memClockMhz: int(f[8]),
      powerW: num(f[9]),
      powerLimitW: num(f[10]),
      utilGpuPct: num(f[11]),
      utilMemPct: num(f[12]),
      vramUsedMib: int(f[13]),
      vramTotalMib: int(f[14]),
      throttleReasons: /^0x[0-9a-fA-F]{1,16}$/.test(reasons) ? reasons : null,
      eccUncorrected: int(f[16]),
    };
  });
  // Single-GPU boxes: a visible process belongs to GPU 0. Names are reduced to a basename and
  // truncated; the device total is what is trusted, not this list (see the foreign-VRAM signal).
  const computeApps =
    gpus.length === 1
      ? (s.apps ?? []).slice(0, 64).map((line) => {
          const [mem, ...rest] = line.split(',');
          const name =
            (rest.join(',').trim().split('/').pop() ?? 'unknown').slice(0, 80) || 'unknown';
          return { gpuIndex: 0, name, vramMib: int(mem) };
        })
      : [];

  const mem: Record<string, number> = {};
  for (const line of s.mem ?? []) {
    const m = /^(\w+):\s+(\d+)/.exec(line);
    if (m) mem[m[1] as string] = Math.round(Number(m[2]) / 1024);
  }
  const load = (s.load?.[0] ?? '').split(' ').map(Number);
  const psi = /avg10=([\d.]+)/.exec(s.psi?.[0] ?? '');
  const df = (s.df?.[0] ?? '').split(/\s+/); // Filesystem 1G-blocks Used Available Use% Mounted
  const dfi = (s.dfi?.[0] ?? '').split(/\s+/); // Filesystem Inodes IUsed IFree IUse% Mounted
  // df's Use% is used / (used + available): root-reserved blocks are not usable. Report the usable
  // size as the total so used/total matches what an operator sees in `df`.
  const usedGb = num(df[2]?.replace('G', ''));
  const availGb = num(df[3]?.replace('G', ''));
  const totalGb = usedGb !== null && availGb !== null ? usedGb + availGb : null;
  const inodePct = num(dfi[4]?.replace('%', ''));
  const swapTotal = mem.SwapTotal ?? null;
  const q = (s.queue?.[0] ?? '').split(' ').map(Number);
  const queueOk = q.length === 2 && q.every(Number.isFinite);

  const services = (s.svc ?? []).map((line) => {
    const [name, active, restarts] = line.split(' ');
    const state = ['active', 'inactive', 'failed', 'activating', 'deactivating'].includes(
      active ?? '',
    )
      ? (active as 'active')
      : 'unknown';
    return { name: name as string, active: state, sub: null, restarts: int(restarts) };
  });

  return {
    v: 1,
    workerId: workerIdOf(box),
    agentVersion: '0.0.0-ssh',
    bootId,
    seq,
    observedAt: Date.now(),
    gpus,
    computeApps,
    host: {
      cpuCount: int(s.cpus?.[0]),
      load1: load[0] ?? null,
      load5: load[1] ?? null,
      load15: load[2] ?? null,
      ramTotalMib: mem.MemTotal ?? null,
      ramAvailMib: mem.MemAvailable ?? null,
      swapTotalMib: swapTotal,
      swapUsedMib: swapTotal === null ? null : swapTotal - (mem.SwapFree ?? swapTotal),
      memPsiSome10: psi ? Number(psi[1]) : null,
      uptimeSec: int(s.uptime?.[0]),
      ntpSynced: s.ntp?.[0] === 'yes' ? true : s.ntp?.[0] === 'no' ? false : null,
      disks: [{ mount: '/', totalGb, usedGb, inodeUsedPct: inodePct }],
    },
    services,
    comfy: [
      {
        instance: 'main',
        reachable: queueOk,
        running: queueOk ? (q[0] as number) : null,
        pending: queueOk ? (q[1] as number) : null,
      },
    ],
  };
}

const { db, close } = createDb(DATABASE_URL);

async function cleanup() {
  const ids = Object.values(WORKER_IDS);
  const list = sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  );
  await db.execute(
    sql`DELETE FROM fleet_incident_events WHERE incident_id IN (SELECT id FROM fleet_incidents WHERE worker_id IN (${list}))`,
  );
  await db.execute(sql`DELETE FROM fleet_incidents WHERE worker_id IN (${list})`);
  for (const t of [
    'fleet_gpu_samples',
    'fleet_host_samples',
    'fleet_gpu_rollups',
    'fleet_host_rollups',
  ]) {
    await db.execute(sql`DELETE FROM ${sql.raw(t)} WHERE worker_id IN (${list})`);
  }
  await db.execute(
    sql`DELETE FROM fleet_agents WHERE label = 'ssh-collector' AND worker_id IN (${list})`,
  );
  console.log(
    'removed the collector keys, samples, rollups and incidents; workers were not touched',
  );
}

async function main() {
  if (process.argv.includes('--cleanup')) return cleanup();
  const once = process.argv.includes('--once');

  const [admin] = await db
    .select({ userId: schema.adminUsers.userId })
    .from(schema.adminUsers)
    .limit(1);
  if (!admin) throw new Error('no admin user in the local database to own the keys');

  // The workers must already exist locally (see fleet-import-workers.mts).
  const have = new Set(
    (await db.select({ id: schema.workers.id }).from(schema.workers)).map((w) => w.id),
  );
  const missing = BOXES.map(workerIdOf).filter((id) => !have.has(id));
  if (missing.length) throw new Error(`worker rows missing locally: ${missing.join(', ')}`);
  const keys = new Map<string, string>();
  for (const b of BOXES) {
    const id = workerIdOf(b);
    await db.execute(
      sql`UPDATE fleet_agents SET revoked_at = now() WHERE worker_id = ${id} AND revoked_at IS NULL AND label = 'ssh-collector'`,
    );
    const k = generateAgentKey();
    keys.set(id, k.key);
    await db.insert(schema.fleetAgents).values({
      workerId: id,
      label: 'ssh-collector',
      keyHash: k.keyHash,
      keyPrefix: k.keyPrefix,
      createdBy: admin.userId,
    });
  }

  const bootId = randomUUID();
  let seq = 0;
  let rolled = 0;
  const round = async () => {
    seq++;
    const results = await Promise.all(
      BOXES.map(async (b) => {
        const id = workerIdOf(b);
        try {
          const body = parse(b, await ssh(b), bootId, seq);
          if (body.gpus.length === 0) return `${b.alias}: no GPU data`;
          const res = await fetch(`${API}/v1/fleet/agent/ingest`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${keys.get(id)}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(body),
          });
          if (res.status !== 200)
            return `${b.alias}: ingest ${res.status} ${(await res.text()).slice(0, 160)}`;
          const g = body.gpus[0];
          return `${b.alias}: ${g?.tempC}C ${g?.smClockMhz}MHz ${g?.vramUsedMib}MiB`;
        } catch (err) {
          return `${b.alias}: unreachable (${(err as Error).message.split('\n')[0]?.slice(0, 80)})`;
        }
      }),
    );
    console.log(new Date().toISOString().slice(11, 19), results.join(' | '));
    // Keep the 1-minute rollups current so the charts fill as data arrives.
    if (Date.now() - rolled > 60_000) {
      rolled = Date.now();
      await runFleetRollupTick({ db } as never, { lookbackMs: 30 * 60_000 }).catch(() => undefined);
    }
  };

  await round();
  if (once) return;
  console.log(`collecting every ${STEP_MS / 1000}s (Ctrl-C to stop)`);
  const timer = setInterval(() => void round(), STEP_MS);
  const stop = () => {
    clearInterval(timer);
    void close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return new Promise(() => undefined);
}

main()
  .then(async () => {
    if (process.argv.includes('--once') || process.argv.includes('--cleanup')) {
      await close();
      process.exit(0);
    }
  })
  .catch(async (err) => {
    console.error(err);
    await close();
    process.exit(1);
  });
