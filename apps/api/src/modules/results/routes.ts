import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { schema } from '@aivastra/db';
import { eq, desc, and, or, ilike, count, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { verifyPassword, signAccess, verifyAccess } from '../auth/service.js';
import { AppError } from '../../lib/errors.js';

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const ResultsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().optional(),
  userId: z.string().uuid().optional(),
  date: z.enum(['any', 'today', '7d', '30d']).default('any'),
  status: z.enum(['completed', 'failed', 'all']).default('completed'),
});

export async function resultsRoutes(app: FastifyInstance) {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);

  async function requireResultsUser(req: FastifyRequest, _reply: FastifyReply) {
    const token = req.cookies['results_access_token'];
    if (!token) throw new AppError('UNAUTH', 401, 'missing results token');
    try {
      const payload = await verifyAccess(secret, token);
      if (payload.kind !== 'results') throw new AppError('UNAUTH', 401, 'invalid token');
      req.userId = String(payload.sub);
      req.adminRole = String(payload.role);
    } catch {
      throw new AppError('UNAUTH', 401, 'invalid token');
    }
  }

  app.post('/results/login', { schema: { body: LoginBody } }, async (req, reply) => {
    const { email, password } = req.body as any;
    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
    if (!user || user.isBanned) throw new AppError('INVALID', 401, 'invalid credentials');
    if (!user.passwordHash) throw new AppError('INVALID', 401, 'invalid credentials');
    if (!(await verifyPassword(user.passwordHash, password))) throw new AppError('INVALID', 401, 'invalid credentials');

    const [admin] = await app.db.select().from(schema.adminUsers).where(eq(schema.adminUsers.userId, user.id));
    if (!admin) throw new AppError('FORBIDDEN', 403, 'admin access required');

    const token = await signAccess(secret, user.id, { kind: 'results', role: admin.role }, '8h');
    reply.setCookie('results_access_token', token, {
      httpOnly: true,
      secure: app.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/results',
      maxAge: 8 * 60 * 60,
    });
    return { ok: true };
  });

  app.post('/results/logout', async (_req, reply) => {
    reply.clearCookie('results_access_token', { path: '/results' });
    return { ok: true };
  });

  app.get('/results/app.js', async (_req, reply) => {
    reply.type('application/javascript').send(appJs());
  });

  app.get('/results', async (req, reply) => {
    try {
      await requireResultsUser(req, reply);
      reply.type('text/html').send(monitorHtml());
    } catch {
      reply.type('text/html').send(loginHtml());
    }
  });

  app.get('/results/data', { preHandler: requireResultsUser, schema: { querystring: ResultsQuery } }, async (req) => {
    const { page, pageSize, search, userId, date, status } = req.query as any;
    const conditions: any[] = [];

    if (status === 'completed') {
      conditions.push(eq(schema.jobs.status, 'COMPLETED'));
    } else if (status === 'failed') {
      conditions.push(eq(schema.jobs.status, 'FAILED'));
    } else {
      conditions.push(or(eq(schema.jobs.status, 'COMPLETED'), eq(schema.jobs.status, 'FAILED')));
    }

    if (userId) conditions.push(eq(schema.jobs.userId, userId));
    if (search) {
      conditions.push(or(
        ilike(schema.users.email, `%${search}%`),
        ilike(schema.jobs.id, `%${search}%`),
      ));
    }
    if (date !== 'any') {
      const now = new Date();
      let cutoff: Date;
      if (date === 'today') {
        cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (date === '7d') {
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else {
        cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }
      conditions.push(gte(schema.jobs.createdAt, cutoff));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ total }] = await app.db
      .select({ total: count() })
      .from(schema.jobs)
      .leftJoin(schema.users, eq(schema.users.id, schema.jobs.userId))
      .leftJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
      .leftJoin(schema.modelPoses, eq(schema.modelPoses.id, schema.jobInputs.poseId))
      .leftJoin(schema.modelBackgrounds, eq(schema.modelBackgrounds.id, schema.jobInputs.backgroundId))
      .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
      .where(where);

    const rows = await app.db
      .select({
        id: schema.jobs.id,
        catalogueId: schema.jobs.catalogueId,
        userEmail: schema.users.email,
        creditsCharged: schema.jobs.creditsCharged,
        createdAt: schema.jobs.createdAt,
        status: schema.jobs.status,
        upperGarmentKey: schema.jobInputs.upperGarmentKey,
        poseThumbKey: schema.modelPoses.thumbnailKey,
        backgroundThumbKey: schema.modelBackgrounds.thumbnailKey,
        lowerThumbKey: sql<string | null>`(select ${schema.catalogItems.thumbnailKey} from ${schema.catalogItems} where ${schema.catalogItems.id} = ${schema.jobInputs.lowerCatalogId})`,
        shoeThumbKey: sql<string | null>`(select ${schema.catalogItems.thumbnailKey} from ${schema.catalogItems} where ${schema.catalogItems.id} = ${schema.jobInputs.shoeCatalogId})`,
        outputKey: schema.jobOutputs.resultKey,
      })
      .from(schema.jobs)
      .leftJoin(schema.users, eq(schema.users.id, schema.jobs.userId))
      .leftJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
      .leftJoin(schema.modelPoses, eq(schema.modelPoses.id, schema.jobInputs.poseId))
      .leftJoin(schema.modelBackgrounds, eq(schema.modelBackgrounds.id, schema.jobInputs.backgroundId))
      .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
      .where(where)
      .orderBy(desc(schema.jobs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const items = rows.map((r) => ({
      id: r.id,
      catalogueId: r.catalogueId,
      userEmail: r.userEmail,
      creditsCharged: r.creditsCharged,
      createdAt: r.createdAt,
      status: r.status,
      garmentUrl: r.upperGarmentKey ? app.storage.publicUrl(r.upperGarmentKey) : null,
      poseUrl: r.poseThumbKey ? app.storage.publicUrl(r.poseThumbKey) : null,
      backgroundUrl: r.backgroundThumbKey ? app.storage.publicUrl(r.backgroundThumbKey) : null,
      lowerUrl: r.lowerThumbKey ? app.storage.publicUrl(r.lowerThumbKey) : null,
      shoeUrl: r.shoeThumbKey ? app.storage.publicUrl(r.shoeThumbKey) : null,
      outputUrl: r.outputKey ? app.storage.publicUrl(r.outputKey) : null,
    }));

    return { page, pageSize, total, items };
  });

  app.get('/results/users', { preHandler: requireResultsUser }, async () => {
    const rows = await app.db
      .selectDistinct({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .innerJoin(schema.jobs, eq(schema.jobs.userId, schema.users.id))
      .orderBy(schema.users.email);
    return rows;
  });
}

function commonCss(): string {
  return `
:root {
  --bg: oklch(0.985 0.005 80);
  --surface: #ffffff;
  --surface-2: oklch(0.97 0.005 80);
  --surface-hover: oklch(0.96 0.006 80);
  --border: oklch(0.91 0.006 80);
  --border-strong: oklch(0.85 0.008 80);
  --ink: oklch(0.18 0.005 80);
  --ink-2: oklch(0.32 0.005 80);
  --muted: oklch(0.52 0.006 80);
  --muted-2: oklch(0.68 0.006 80);
  --accent: oklch(0.55 0.12 240);
  --accent-soft: oklch(0.94 0.04 240);
  --accent-ink: oklch(0.36 0.12 240);
  --danger: oklch(0.58 0.2 25);
  --danger-soft: oklch(0.95 0.04 25);
  --sans: 'Geist', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --mono: 'Geist Mono', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --r: 6px;
  --r-lg: 10px;
  --shadow-sm: 0 1px 0 0 oklch(0.85 0.008 80 / 0.3);
  --shadow-md: 0 1px 2px oklch(0.5 0.01 80 / 0.06), 0 4px 12px oklch(0.5 0.01 80 / 0.05);
}
[data-theme='dark'] {
  --bg: oklch(0.18 0.006 80);
  --surface: oklch(0.22 0.006 80);
  --surface-2: oklch(0.25 0.006 80);
  --surface-hover: oklch(0.28 0.006 80);
  --border: oklch(0.3 0.006 80);
  --border-strong: oklch(0.4 0.008 80);
  --ink: oklch(0.96 0.005 80);
  --ink-2: oklch(0.85 0.005 80);
  --muted: oklch(0.62 0.006 80);
  --muted-2: oklch(0.48 0.006 80);
  --accent: oklch(0.65 0.13 240);
  --accent-soft: oklch(0.27 0.05 240);
  --accent-ink: oklch(0.82 0.1 240);
  --danger: oklch(0.65 0.2 25);
  --danger-soft: oklch(0.28 0.07 25);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: 14px; line-height: 1.45; -webkit-font-smoothing: antialiased; }
body { min-width: 1024px; }
button, input, select { font-family: inherit; font-size: inherit; color: inherit; }
button { cursor: pointer; }
`;
}

function loginHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Results — Sign in</title>
<style>
${commonCss()}
.login-wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.login-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg);
  padding: 40px; width: 100%; max-width: 400px; box-shadow: var(--shadow-md);
}
.login-card h1 { margin: 0 0 6px; font-size: 20px; font-weight: 500; letter-spacing: -0.01em; }
.login-card p { margin: 0 0 24px; color: var(--muted); font-size: 13px; }
.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.field label { font-size: 12px; color: var(--ink-2); font-weight: 500; }
.field input {
  border: 1px solid var(--border); border-radius: var(--r); padding: 9px 11px;
  background: var(--surface-2); outline: 0; transition: border-color 120ms ease;
}
.field input:focus { border-color: var(--accent); }
.login-btn {
  width: 100%; padding: 10px; border-radius: var(--r); border: 0; background: var(--accent); color: #fff;
  font-weight: 600; font-size: 14px; transition: filter 120ms ease; margin-bottom: 8px;
}
.login-btn:hover { filter: brightness(1.1); }
.login-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.error-msg { color: var(--danger); font-size: 13px; min-height: 20px; }
.brand { display: flex; align-items: center; gap: 10px; margin-bottom: 22px; }
.brand-mark {
  width: 32px; height: 32px; border-radius: 7px; background: var(--accent);
  display: grid; place-items: center; color: #fff; font-weight: 600; font-size: 16px;
}
.brand-text { font-size: 16px; font-weight: 500; }
</style>
</head>
<body>
<div class="login-wrap">
  <div class="login-card">
    <div class="brand">
      <div class="brand-mark">A</div>
      <div class="brand-text">Aivastra Results</div>
    </div>
    <h1>Sign in</h1>
    <p>Use your admin credentials to view results.</p>
    <div class="field">
      <label for="email">Email</label>
      <input type="email" id="email" placeholder="admin@example.com" autofocus />
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input type="password" id="password" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" />
    </div>
    <button type="button" class="login-btn" id="login-btn">Sign in</button>
    <div class="error-msg" id="error-msg"></div>
  </div>
</div>
<script src="/results/app.js"></script>
</body>
</html>`;
}

function monitorHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Webtool results (all users)</title>
<style>
${commonCss()}
.page { max-width: 1600px; margin: 0 auto; padding: 24px 28px 40px; }
.header {
  display: flex; align-items: flex-end; justify-content: space-between;
  margin-bottom: 20px; gap: 16px; flex-wrap: wrap;
}
.header h1 { margin: 0; font-size: 22px; font-weight: 500; letter-spacing: -0.012em; color: var(--ink); }
.header p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
.header-actions { display: flex; gap: 8px; align-items: center; }

.filters {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg);
  padding: 16px 18px; display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap;
  margin-bottom: 16px; box-shadow: var(--shadow-sm);
}
.filter-group { display: flex; flex-direction: column; gap: 5px; min-width: 160px; flex: 1; }
.filter-group label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 500; }
.select, .search-input {
  border: 1px solid var(--border); border-radius: var(--r); padding: 7px 10px;
  background: var(--surface-2); color: var(--ink); outline: 0; width: 100%;
}
.select { appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path d='M2 4l3 3 3-3' stroke='%23999' stroke-width='1.2' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>"); background-repeat: no-repeat; background-position: right 10px center; padding-right: 28px; }
.search-input { padding-left: 30px; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='11' cy='11' r='8'/><line x1='21' y1='21' x2='16.65' y2='16.65'/></svg>"); background-repeat: no-repeat; background-position: 8px center; }
[data-theme='dark'] .select { background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path d='M2 4l3 3 3-3' stroke='%23aaa' stroke-width='1.2' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>"); }
[data-theme='dark'] .search-input { background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23aaa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='11' cy='11' r='8'/><line x1='21' y1='21' x2='16.65' y2='16.65'/></svg>"); }

.btn {
  display: inline-flex; align-items: center; gap: 6px; font-size: 13px; padding: 7px 14px;
  border-radius: var(--r); border: 1px solid var(--border); background: var(--surface); color: var(--ink);
  font-weight: 500; line-height: 1; transition: background 80ms ease, border-color 80ms ease; white-space: nowrap;
}
.btn:hover { background: var(--surface-hover); border-color: var(--border-strong); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.primary:hover { filter: brightness(1.1); }
.btn.ghost { background: transparent; border-color: transparent; color: var(--muted); }
.btn.ghost:hover { background: var(--surface-2); color: var(--ink); }
.btn.danger { color: var(--danger); border-color: var(--border); }
.btn.danger:hover { background: var(--danger-soft); border-color: var(--danger); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.info-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; color: var(--muted); font-size: 13px; }

.table-wrap { border: 1px solid var(--border); border-radius: var(--r-lg); overflow: hidden; background: var(--surface); }
.results-table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
.results-table th {
  text-align: left; padding: 10px 12px; background: var(--surface-2); color: var(--muted); font-size: 11px;
  letter-spacing: 0.08em; text-transform: uppercase; border-bottom: 1px solid var(--border); font-weight: 500;
}
.results-table td { padding: 12px; border-bottom: 1px solid var(--border); vertical-align: top; color: var(--ink); }
.results-table tr:hover td { background: var(--surface-hover); }
.results-table tr:last-child td { border-bottom: 0; }

.col-id { width: 70px; }
.col-user { width: 190px; }
.col-img { width: 130px; text-align: center; }
.col-credits { width: 70px; text-align: center; }
.col-when { width: 150px; }

.id-num { font-family: var(--mono); font-size: 13px; font-weight: 500; color: var(--ink); }
.id-sub { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-top: 2px; }
.user-name { font-weight: 500; color: var(--ink); word-break: break-all; }
.user-email { font-size: 12px; color: var(--muted); margin-top: 2px; word-break: break-all; }

.thumb-wrap { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.thumb {
  width: 100%; max-width: 110px; aspect-ratio: 3/4; object-fit: cover;
  border-radius: var(--r); border: 1px solid var(--border); background: var(--surface-2);
  cursor: zoom-in; transition: transform 120ms ease, box-shadow 120ms ease;
}
.thumb:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
.thumb-placeholder {
  width: 100%; max-width: 110px; aspect-ratio: 3/4; border-radius: var(--r); border: 1px dashed var(--border);
  background: var(--surface-2); display: grid; place-items: center; color: var(--muted-2); font-size: 18px;
}
.img-links { display: flex; gap: 6px; justify-content: center; }
.img-links a {
  font-size: 11px; color: var(--accent-ink); text-decoration: none; padding: 3px 8px;
  border: 1px solid var(--border); border-radius: var(--r); background: var(--surface-2);
  transition: background 80ms ease, border-color 80ms ease;
}
.img-links a:hover { background: var(--accent-soft); border-color: var(--accent); }
.credits-num { font-family: var(--mono); font-weight: 500; }
.when-text { font-size: 12px; color: var(--muted); font-family: var(--mono); }

.pager { display: flex; justify-content: flex-end; align-items: center; gap: 6px; margin-top: 18px; padding: 12px 0; }
.pager-info { margin-right: auto; color: var(--muted); font-size: 12.5px; }
.pager button {
  min-width: 32px; height: 32px; border: 1px solid var(--border); background: var(--surface); border-radius: var(--r);
  font-size: 12px; color: var(--ink); cursor: pointer; transition: background 80ms ease;
}
.pager button:hover:not(.active):not(:disabled) { background: var(--surface-2); }
.pager button.active { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.pager button:disabled { opacity: 0.4; cursor: not-allowed; }

.lightbox {
  position: fixed; inset: 0; background: rgba(0,0,0,0.88); z-index: 100;
  display: none; justify-content: center; align-items: center; cursor: zoom-out; backdrop-filter: blur(2px);
}
.lightbox.active { display: flex; }
.lightbox img { max-width: 92vw; max-height: 92vh; border-radius: var(--r-lg); box-shadow: 0 24px 64px rgba(0,0,0,0.6); }
.lightbox-close {
  position: absolute; top: 20px; right: 24px; color: #fff; font-size: 32px; line-height: 1;
  cursor: pointer; opacity: 0.8; transition: opacity 120ms ease; user-select: none;
}
.lightbox-close:hover { opacity: 1; }

.toast-stack { position: fixed; bottom: 24px; right: 24px; z-index: 50; display: flex; flex-direction: column; gap: 8px; width: 340px; }
.toast {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg);
  box-shadow: var(--shadow-md); padding: 12px 14px; display: flex; gap: 10px; align-items: flex-start;
  animation: slide-up 180ms ease;
}
@keyframes slide-up { from { transform: translateY(8px); opacity: 0; } }
.toast.error { border-left: 3px solid var(--danger); }
.toast .body { flex: 1; font-size: 13px; color: var(--ink); }

.skel {
  background: linear-gradient(90deg, var(--surface-2) 0%, var(--border-strong) 50%, var(--surface-2) 100%);
  background-size: 200% 100%; animation: shimmer 1.4s linear infinite; border-radius: 4px; display: inline-block;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

.empty-state { text-align: center; padding: 48px 24px; color: var(--muted); }
.empty-state .ico { width: 48px; height: 48px; margin: 0 auto 14px; border-radius: 12px; background: var(--surface-2); display: grid; place-items: center; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <h1>Webtool results (all users)</h1>
      <p id="subhead">Monitor completed outputs from ComfyUI across all users.</p>
    </div>
    <div class="header-actions">
      <button class="btn ghost" id="theme-toggle" title="Toggle theme">Theme</button>
      <button class="btn danger ghost" id="logout-btn">Log out</button>
    </div>
  </div>

  <div class="filters">
    <div class="filter-group">
      <label>User</label>
      <select class="select" id="filter-user"><option value="">All users</option></select>
    </div>
    <div class="filter-group" style="min-width:140px;flex:0">
      <label>Date</label>
      <select class="select" id="filter-date">
        <option value="any">Any time</option>
        <option value="today">Today</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
      </select>
    </div>
    <div class="filter-group" style="min-width:140px;flex:0">
      <label>Status</label>
      <select class="select" id="filter-status">
        <option value="completed">Completed</option>
        <option value="failed">Failed</option>
        <option value="all">All</option>
      </select>
    </div>
    <div class="filter-group">
      <label>Search</label>
      <input class="search-input" id="filter-search" placeholder="Username, email, job ID…" />
    </div>
    <button class="btn primary" id="btn-apply">Apply</button>
    <button class="btn ghost" id="btn-clear">Clear all</button>
  </div>

  <div class="info-bar">
    <span id="result-count">Loading…</span>
  </div>

  <div class="table-wrap">
    <table class="results-table">
      <thead>
        <tr>
          <th class="col-id">ID</th>
          <th class="col-user">User</th>
          <th class="col-img">Garment</th>
          <th class="col-img">Pose</th>
          <th class="col-img">Background</th>
          <th class="col-img">Shoes</th>
          <th class="col-img">Output</th>
          <th class="col-credits">Credits</th>
          <th class="col-when">When</th>
        </tr>
      </thead>
      <tbody id="results-body"></tbody>
    </table>
  </div>

  <div class="pager" id="pager"></div>
</div>

<div class="lightbox" id="lightbox">
  <span class="lightbox-close" id="lightbox-close">&times;</span>
  <img id="lightbox-img" src="" alt="Preview" />
</div>

<div class="toast-stack" id="toast-stack"></div>
<script src="/results/app.js"></script>
</body>
</html>`;
}

function appJs(): string {
  return `(function() {
  'use strict';

  // ── Theme ──────────────────────────────────────────────────────────────────
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }
  (function initTheme() {
    var stored = localStorage.getItem('aivastra-theme');
    if (stored) { applyTheme(stored); return; }
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) applyTheme('dark');
    else applyTheme('light');
  })();

  // ── Helpers ────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(m) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m];
    });
  }

  function toast(msg, kind) {
    var stack = document.getElementById('toast-stack');
    if (!stack) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = '<div class="body">' + esc(msg) + '</div>';
    stack.appendChild(el);
    setTimeout(function() { el.remove(); }, 4000);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOGIN PAGE
  // ═══════════════════════════════════════════════════════════════════════════
  var loginBtn = document.getElementById('login-btn');
  if (loginBtn) {
    var err = document.getElementById('error-msg');
    var emailField = document.getElementById('email');
    var passwordField = document.getElementById('password');

    function doLogin() {
      var e = emailField.value.trim();
      var p = passwordField.value;
      if (!e || !p) { err.textContent = 'Email and password are required'; return; }
      loginBtn.disabled = true;
      err.textContent = '';
      fetch('/results/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e, password: p }),
      }).then(function(res) {
        if (!res.ok) return res.json().then(function(body) {
          throw new Error((body.error && body.error.message) || 'Sign in failed');
        });
        window.location.reload();
      }).catch(function(ex) {
        err.textContent = ex.message;
        loginBtn.disabled = false;
      });
    }

    loginBtn.addEventListener('click', doLogin);
    passwordField.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') doLogin(); });
    emailField.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') passwordField.focus(); });
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MONITOR PAGE
  // ═══════════════════════════════════════════════════════════════════════════
  var resultsBody = document.getElementById('results-body');
  if (!resultsBody) return;

  var state = {
    page: 1, pageSize: 25, total: 0, items: [], users: [],
    filters: { userId: '', date: 'any', search: '', status: 'completed' },
    loading: false,
  };

  function $(id) { return document.getElementById(id); }

  function api(path) {
    return fetch(path, { credentials: 'include' }).then(function(res) {
      if (res.status === 401) { window.location.reload(); throw new Error('Session expired'); }
      if (!res.ok) return res.json().then(function(body) {
        throw new Error((body.error && body.error.message) || 'HTTP ' + res.status);
      });
      return res.json();
    });
  }

  function loadUsers() {
    api('/results/users').then(function(users) {
      state.users = users;
      var sel = $('filter-user');
      sel.innerHTML = '<option value="">All users</option>' + users.map(function(u) {
        return '<option value="' + esc(u.id) + '">' + esc(u.email) + '</option>';
      }).join('');
    }).catch(function(e) { toast('Failed to load users: ' + e.message, 'error'); });
  }

  function loadData() {
    state.loading = true;
    renderSkeleton();
    var p = new URLSearchParams();
    p.set('page', String(state.page));
    p.set('pageSize', String(state.pageSize));
    if (state.filters.userId) p.set('userId', state.filters.userId);
    if (state.filters.date !== 'any') p.set('date', state.filters.date);
    if (state.filters.search) p.set('search', state.filters.search);
    if (state.filters.status !== 'completed') p.set('status', state.filters.status);
    api('/results/data?' + p.toString()).then(function(data) {
      state.items = data.items || [];
      state.total = data.total || 0;
      state.page = data.page || 1;
      state.loading = false;
      render();
    }).catch(function(e) {
      toast('Error loading results: ' + e.message, 'error');
      state.items = [];
      state.total = 0;
      state.loading = false;
      render();
    });
  }

  function renderSkeleton() {
    var rows = [];
    for (var r = 0; r < 5; r++) {
      rows.push('<tr><td class="col-id"><div class="skel" style="height:14px;width:40px"></div></td>' +
        '<td class="col-user"><div class="skel" style="height:14px;width:130px"></div></td>' +
        '<td class="col-img"><div class="skel" style="height:90px;width:70px;margin:0 auto"></div><div class="skel" style="height:10px;width:80px;margin:6px auto 0"></div></td>' +
        '<td class="col-img"><div class="skel" style="height:90px;width:70px;margin:0 auto"></div><div class="skel" style="height:10px;width:80px;margin:6px auto 0"></div></td>' +
        '<td class="col-img"><div class="skel" style="height:90px;width:70px;margin:0 auto"></div><div class="skel" style="height:10px;width:80px;margin:6px auto 0"></div></td>' +
        '<td class="col-img"><div class="skel" style="height:90px;width:70px;margin:0 auto"></div><div class="skel" style="height:10px;width:80px;margin:6px auto 0"></div></td>' +
        '<td class="col-img"><div class="skel" style="height:90px;width:70px;margin:0 auto"></div><div class="skel" style="height:10px;width:80px;margin:6px auto 0"></div></td>' +
        '<td class="col-credits"><div class="skel" style="height:14px;width:30px;margin:0 auto"></div></td>' +
        '<td class="col-when"><div class="skel" style="height:14px;width:110px"></div></td></tr>');
    }
    resultsBody.innerHTML = rows.join('');
    $('result-count').textContent = 'Loading…';
    $('pager').innerHTML = '';
  }

  function render() {
    var totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    $('result-count').textContent = state.total + ' output(s) — page ' + state.page + ' of ' + totalPages;

    if (state.items.length === 0) {
      resultsBody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="ico"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg></div><div>No results found.</div></div></td></tr>';
    } else {
      var rows = [];
      for (var i = 0; i < state.items.length; i++) {
        var item = state.items[i];
        var seq = (state.page - 1) * state.pageSize + i + 1;
        var rev = state.total - ((state.page - 1) * state.pageSize + i);
        rows.push(
          '<tr>' +
          '<td class="col-id"><div class="id-num">' + rev + '</div><div class="id-sub">#' + seq + '</div></td>' +
          '<td class="col-user"><div class="user-name">' + esc(item.userEmail || '—') + '</div><div class="user-email">' + esc(item.userEmail || '') + '</div></td>' +
          '<td class="col-img">' + renderThumb(item.garmentUrl, 'Garment') + '</td>' +
          '<td class="col-img">' + renderThumb(item.poseUrl, 'Pose') + '</td>' +
          '<td class="col-img">' + renderThumb(item.backgroundUrl, 'Background') + '</td>' +
          '<td class="col-img">' + renderThumb(item.shoeUrl, 'Shoes') + '</td>' +
          '<td class="col-img">' + renderThumb(item.outputUrl, 'Output') + '</td>' +
          '<td class="col-credits"><span class="credits-num">' + item.creditsCharged + '</span></td>' +
          '<td class="col-when"><span class="when-text">' + fmtDate(item.createdAt) + '</span></td>' +
          '</tr>'
        );
      }
      resultsBody.innerHTML = rows.join('');
    }
    renderPager(totalPages);
  }

  function renderThumb(url, label) {
    if (!url) return '<div class="thumb-placeholder">—</div>';
    return '<div class="thumb-wrap">' +
      '<img class="thumb" src="' + esc(url) + '" alt="' + esc(label) + '" loading="lazy" data-lb="' + esc(url) + '" onclick="window.openLightbox(this.dataset.lb)">' +
      '<div class="img-links">' +
        '<a href="' + esc(url) + '" target="_blank" rel="noreferrer">Open</a>' +
        '<a href="' + esc(url) + '" target="_blank" rel="noreferrer" download="' + esc(label.toLowerCase()) + '.jpg">Download</a>' +
      '</div>' +
    '</div>';
  }

  function renderPager(totalPages) {
    if (totalPages <= 1 && state.total === 0) { $('pager').innerHTML = ''; return; }
    var html = '<span class="pager-info">' + state.total + ' total</span>';
    html += '<button ' + (state.page === 1 ? 'disabled' : '') + ' data-page="' + (state.page - 1) + '">Prev</button>';
    var maxButtons = 7;
    var start = Math.max(1, state.page - Math.floor(maxButtons / 2));
    var end = Math.min(totalPages, start + maxButtons - 1);
    if (end - start < maxButtons - 1) start = Math.max(1, end - maxButtons + 1);
    if (start > 1) html += '<button data-page="1">1</button><span style="color:var(--muted);padding:0 4px">…</span>';
    for (var i = start; i <= end; i++) {
      html += '<button class="' + (i === state.page ? 'active' : '') + '" data-page="' + i + '">' + i + '</button>';
    }
    if (end < totalPages) html += '<span style="color:var(--muted);padding:0 4px">…</span><button data-page="' + totalPages + '">' + totalPages + '</button>';
    html += '<button ' + (state.page === totalPages ? 'disabled' : '') + ' data-page="' + (state.page + 1) + '">Next</button>';
    $('pager').innerHTML = html;
    var btns = $('pager').querySelectorAll('button[data-page]');
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener('click', (function(pg) { return function() { state.page = pg; loadData(); }; })(Number(btns[j].getAttribute('data-page'))));
    }
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    var pad = function(n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  // Theme toggle
  $('theme-toggle').addEventListener('click', function() {
    var current = document.documentElement.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('aivastra-theme', next);
  });

  // Lightbox
  window.openLightbox = function(url) {
    $('lightbox-img').src = url;
    $('lightbox').classList.add('active');
  };
  $('lightbox').addEventListener('click', function() { $('lightbox').classList.remove('active'); });
  $('lightbox-close').addEventListener('click', function(e) { e.stopPropagation(); $('lightbox').classList.remove('active'); });

  // Filters
  $('btn-apply').addEventListener('click', function() {
    state.filters.userId = $('filter-user').value;
    state.filters.date = $('filter-date').value;
    state.filters.status = $('filter-status').value;
    state.filters.search = $('filter-search').value.trim();
    state.page = 1;
    loadData();
  });
  $('btn-clear').addEventListener('click', function() {
    $('filter-user').value = '';
    $('filter-date').value = 'any';
    $('filter-status').value = 'completed';
    $('filter-search').value = '';
    state.filters = { userId: '', date: 'any', search: '', status: 'completed' };
    state.page = 1;
    loadData();
  });

  // Logout
  $('logout-btn').addEventListener('click', function() {
    fetch('/results/logout', { method: 'POST', credentials: 'include' }).then(function() {
      window.location.reload();
    }).catch(function() {
      window.location.reload();
    });
  });

  // Keyboard
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') $('lightbox').classList.remove('active'); });

  // Boot
  loadUsers();
  loadData();
})();
`;
}
