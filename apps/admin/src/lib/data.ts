import type { Stats, CatalogItem, User, Job } from '../types';

export const TONES = [
  'oklch(0.86 0.04 60)',
  'oklch(0.72 0.08 35)',
  'oklch(0.58 0.06 30)',
  'oklch(0.40 0.02 270)',
  'oklch(0.82 0.03 90)',
  'oklch(0.68 0.08 110)',
];

export const STATUS_ORDER = ['QUEUED', 'PREPROCESSING', 'GENERATING', 'UPLOADING', 'COMPLETED'] as const;

export function statusBadge(s: string): [string, string] {
  const m: Record<string, [string, string]> = {
    QUEUED: ['info', 'Queued'],
    PREPROCESSING: ['accent', 'Preprocessing'],
    GENERATING: ['accent', 'Generating'],
    UPLOADING: ['accent', 'Uploading'],
    COMPLETED: ['success', 'Completed'],
    FAILED: ['danger', 'Failed'],
    CANCELLED: ['', 'Cancelled'],
    IDLE: ['', 'Idle'],
    BUSY: ['accent', 'Busy'],
    DRAINING: ['warn', 'Draining'],
    OFFLINE: ['danger', 'Offline'],
    active: ['success', 'Active'],
    inactive: ['', 'Inactive'],
    draft: ['', 'Draft'],
    archived: ['', 'Archived'],
  };
  return m[s] || ['', s];
}

export const MOCK_STATS: Stats = {
  jobsToday: 1247,
  jobsTodayDelta: 12.4,
  creditsToday: 6235,
  creditsTodayDelta: 8.1,
  activeUsersToday: 384,
  activeUsersDelta: -2.6,
  workersHealthy: 6,
  workersTotal: 8,
  queueDepth: 41,
  failed24h: 23,
  failed24hDelta: 156,
  jobsPerDay: [890, 1024, 1156, 982, 1340, 1421, 1247],
  jobsPerDayLabels: ['May 13', 'May 14', 'May 15', 'May 16', 'May 17', 'May 18', 'Today'],
};

export const MOCK_USERS: User[] = [
  { id: 'u_a1b2c3', name: 'Felix Marchetti', email: 'felix@marchetti.tn', role: 'CREATOR', plan: 'Scale', creditsRemaining: 12470, creditLimit: 25000, totalJobs: 842, joinedAt: '2025-09-12', lastActive: '2026-05-19 14:23', emailVerified: true, status: 'active', recentJobs: [{ id: 'j_f7c2a4', status: 'COMPLETED', createdAt: '2m ago', duration: '34.2s' }, { id: 'j_k8e2d4', status: 'COMPLETED', createdAt: '15m ago', duration: '28.1s' }] },
  { id: 'u_d4e5f6', name: 'Karim Mansour', email: 'karim.m@cairo-cut.eg', role: 'CREATOR', plan: 'Growth', creditsRemaining: 3420, creditLimit: 10000, totalJobs: 215, joinedAt: '2026-01-08', lastActive: '2026-05-19 11:05', emailVerified: true, status: 'active', recentJobs: [{ id: 'j_e8d4c2', status: 'COMPLETED', createdAt: '1h ago', duration: '42.7s' }] },
  { id: 'u_g7h8i9', name: 'Lior Ben-David', email: 'lior@studio-lb.co.il', role: 'CREATOR', plan: 'Enterprise', creditsRemaining: 89200, creditLimit: 200000, totalJobs: 3412, joinedAt: '2025-06-03', lastActive: '2026-05-19 13:47', emailVerified: true, status: 'active' },
  { id: 'u_j0k1l2', name: 'Aisha Patel', email: 'aisha@visual-stories.in', role: 'CREATOR', plan: 'Growth', creditsRemaining: 1890, creditLimit: 10000, totalJobs: 98, joinedAt: '2026-03-22', lastActive: '2026-05-18 22:10', emailVerified: true, status: 'active' },
  { id: 'u_m3n4o5', name: 'Chen Wei', email: 'chen.w@shanghai-ai.cn', role: 'CREATOR', plan: 'Starter', creditsRemaining: 450, creditLimit: 5000, totalJobs: 34, joinedAt: '2026-04-15', lastActive: '2026-05-17 16:30', emailVerified: false, status: 'active' },
  { id: 'u_p6q7r8', name: 'Oliver Schmidt', email: 'oliver@berlin-gen.ai', role: 'CREATOR', plan: 'Scale', creditsRemaining: 28400, creditLimit: 50000, totalJobs: 1567, joinedAt: '2025-11-20', lastActive: '2026-05-19 12:18', emailVerified: true, status: 'active' },
  { id: 'u_s9t0u1', name: 'Sarah Kim', email: 'sarah@seoul-studio.kr', role: 'CREATOR', plan: 'Growth', creditsRemaining: 6700, creditLimit: 10000, totalJobs: 423, joinedAt: '2026-02-01', lastActive: '2026-05-19 09:44', emailVerified: true, status: 'active' },
  { id: 'u_v2w3x4', name: 'James Wilson', email: 'james.w@london-creative.uk', role: 'CREATOR', plan: 'Starter', creditsRemaining: 120, creditLimit: 5000, totalJobs: 8, joinedAt: '2026-05-10', lastActive: '2026-05-16 14:02', emailVerified: true, status: 'active' },
  { id: 'u_y5z6a7', name: 'Maria Garcia', email: 'maria@barcelona-art.es', role: 'CREATOR', plan: 'Scale', creditsRemaining: 15100, creditLimit: 25000, totalJobs: 689, joinedAt: '2025-10-05', lastActive: '2026-05-19 10:31', emailVerified: true, status: 'active' },
  { id: 'u_b8c9d0', name: 'Tariq Syed', email: 'tariq@dubai-frame.ae', role: 'CREATOR', plan: 'Growth', creditsRemaining: 5100, creditLimit: 10000, totalJobs: 267, joinedAt: '2026-01-28', lastActive: '2026-05-18 20:15', emailVerified: true, status: 'active' },
  { id: 'u_e1f2g3', name: 'Yuki Tanaka', email: 'yuki@tokyo-pixel.jp', role: 'CREATOR', plan: 'Scale', creditsRemaining: 22300, creditLimit: 25000, totalJobs: 1102, joinedAt: '2025-08-17', lastActive: '2026-05-19 14:01', emailVerified: true, status: 'active' },
  { id: 'u_h4i5j6', name: 'Suspended User', email: 'suspended@example.com', role: 'CREATOR', plan: 'Starter', creditsRemaining: 0, creditLimit: 5000, totalJobs: 45, joinedAt: '2026-01-10', lastActive: '2026-04-30 08:12', emailVerified: true, status: 'suspended' },
];

export const MOCK_CATALOG: CatalogItem[] = [
  { id: 'mod_sd_xl', name: 'SDXL 1.0', type: 'models', category: 'Text-to-Image', baseModel: 'SDXL 1.0', license: 'Open RAIL-M', maxResolution: '1024×1024', steps: '20-50', guidanceScale: '7.5', pricePerJob: 0.0250, status: 'active', lastUsed: '2m ago', description: 'Stable Diffusion XL 1.0 base model — high-quality text-to-image generation with improved composition and face rendering.', thumbnail: 'https://picsum.photos/seed/sdxl/400/300', version: '1.0.0', totalJobs: 45210, successRate: 98.2, avgDuration: '34.2s' },
  { id: 'mod_sd_3', name: 'SD 3.5', type: 'models', category: 'Text-to-Image', baseModel: 'SD 3.5', license: 'Open RAIL-M', maxResolution: '1024×1024', steps: '20-40', guidanceScale: '5.0', pricePerJob: 0.0300, status: 'active', lastUsed: '1m ago', description: 'Stable Diffusion 3.5 — next-gen transformer-based architecture for superior prompt adherence.', thumbnail: 'https://picsum.photos/seed/sd35/400/300', version: '3.5.0', totalJobs: 18240, successRate: 97.8, avgDuration: '41.5s' },
  { id: 'mod_flux', name: 'Flux Pro', type: 'models', category: 'Text-to-Image', baseModel: 'Flux.1', license: 'Proprietary', maxResolution: '2048×2048', steps: '20-50', guidanceScale: '3.5', pricePerJob: 0.0500, status: 'active', lastUsed: '3m ago', description: 'Flux Pro — Black Forest Labs flagship model with exceptional photorealism.', thumbnail: 'https://picsum.photos/seed/flux/400/300', version: '1.1.0', totalJobs: 8930, successRate: 99.1, avgDuration: '52.8s' },
  { id: 'lora_mj', name: 'Midjourney Style', type: 'lora', category: 'Style', baseModel: 'SDXL 1.0', license: 'CC BY-NC 4.0', maxResolution: '1024×1024', steps: '25', guidanceScale: '6.0', pricePerJob: 0.0080, status: 'active', lastUsed: '5m ago', description: 'Midjourney aesthetic LoRA — dreamy, painterly style with vibrant colors.', thumbnail: 'https://picsum.photos/seed/lora-mj/400/300', version: '2.1.0', totalJobs: 22400, successRate: 96.5, avgDuration: '28.4s' },
  { id: 'lora_vox', name: 'Voxel Art', type: 'lora', category: 'Style', baseModel: 'SDXL 1.0', license: 'CC BY 4.0', maxResolution: '1024×1024', steps: '30', guidanceScale: '7.0', pricePerJob: 0.0060, status: 'active', lastUsed: '12m ago', description: 'Voxel-style 3D block aesthetic LoRA for game asset prototyping.', thumbnail: 'https://picsum.photos/seed/voxel/400/300', version: '1.0.0', totalJobs: 5670, successRate: 95.8, avgDuration: '32.1s' },
  { id: 'lora_ink', name: 'Ink Wash', type: 'lora', category: 'Style', baseModel: 'SDXL 1.0', license: 'CC BY-NC 4.0', maxResolution: '1024×1024', steps: '35', guidanceScale: '8.0', pricePerJob: 0.0070, status: 'active', lastUsed: '28m ago', description: 'Traditional East Asian ink wash painting style LoRA.', thumbnail: 'https://picsum.photos/seed/ink/400/300', version: '1.2.0', totalJobs: 8910, successRate: 97.2, avgDuration: '30.7s' },
  { id: 'emb_depth', name: 'Depth Control', type: 'embeddings', category: 'Control', baseModel: 'SDXL 1.0', license: 'MIT', maxResolution: '1024×1024', steps: '25', guidanceScale: '6.0', pricePerJob: 0.0050, status: 'active', lastUsed: '1h ago', description: 'Depth map control embedding — preserves scene structure from reference images.', thumbnail: 'https://picsum.photos/seed/depth/400/300', version: '1.0.0', totalJobs: 15300, successRate: 98.9, avgDuration: '26.3s' },
  { id: 'mod_draft', name: 'Experimental v2', type: 'models', category: 'Text-to-Image', baseModel: 'Custom', license: 'Proprietary', maxResolution: '512×512', steps: '20', guidanceScale: '5.0', pricePerJob: 0.0100, status: 'draft', lastUsed: '', description: 'Internal experimental model — not yet ready for production.', thumbnail: 'https://picsum.photos/seed/exp/400/300', version: '0.2.0' },
  { id: 'mod_archived', name: 'Legacy v1', type: 'models', category: 'Text-to-Image', baseModel: 'SD 1.5', license: 'Open RAIL-M', maxResolution: '512×512', steps: '20-50', guidanceScale: '7.5', pricePerJob: 0.0100, status: 'archived', lastUsed: '2026-03-15', description: 'Legacy Stable Diffusion 1.5 model — superseded by newer versions.', thumbnail: 'https://picsum.photos/seed/legacy/400/300', version: '1.5.0', totalJobs: 120400, successRate: 94.3, avgDuration: '22.1s' },
  { id: 'lora_cyber', name: 'Cyberpunk', type: 'lora', category: 'Style', baseModel: 'SDXL 1.0', license: 'CC BY-NC 4.0', maxResolution: '1024×1024', steps: '25', guidanceScale: '7.0', pricePerJob: 0.0075, status: 'active', lastUsed: '8m ago', description: 'Cyberpunk neon aesthetic with rain-soaked streets and holographic displays.', thumbnail: 'https://picsum.photos/seed/cyber/400/300', version: '1.1.0', totalJobs: 12450, successRate: 96.1, avgDuration: '29.8s' },
  { id: 'lora_anime', name: 'Anime v2', type: 'lora', category: 'Style', baseModel: 'SDXL 1.0', license: 'CC BY-NC 4.0', maxResolution: '1024×1024', steps: '28', guidanceScale: '6.5', pricePerJob: 0.0065, status: 'active', lastUsed: '4m ago', description: 'Anime-style LoRA with cel-shaded rendering and expressive features.', thumbnail: 'https://picsum.photos/seed/anime/400/300', version: '2.0.0', totalJobs: 38900, successRate: 97.5, avgDuration: '27.4s' },
  { id: 'emb_canny', name: 'Canny Edge', type: 'embeddings', category: 'Control', baseModel: 'SDXL 1.0', license: 'MIT', maxResolution: '1024×1024', steps: '25', guidanceScale: '6.0', pricePerJob: 0.0050, status: 'active', lastUsed: '35m ago', description: 'Canny edge detection control — preserves line art and edges from reference images.', thumbnail: 'https://picsum.photos/seed/canny/400/300', version: '1.0.1', totalJobs: 9800, successRate: 98.2, avgDuration: '25.9s' },
  { id: 'mod_small', name: 'SD Turbo', type: 'models', category: 'Text-to-Image', baseModel: 'SD Turbo', license: 'Open RAIL-M', maxResolution: '512×512', steps: '1-4', guidanceScale: '2.0', pricePerJob: 0.0050, status: 'active', lastUsed: '6m ago', description: 'SD Turbo — real-time image generation in 1-4 steps. Ideal for rapid prototyping.', thumbnail: 'https://picsum.photos/seed/turbo/400/300', version: '1.0.0', totalJobs: 34200, successRate: 96.8, avgDuration: '3.2s' },
];

export const MOCK_JOBS: Job[] = [
  { id: 'j_a1b2c3d4', user: 'felix@marchetti.tn', type: 'txt2img', model: 'SDXL 1.0', worker: 'wrk-7af2-eu-1', status: 'COMPLETED', duration: '34.2s', creditsCost: 25, priority: 0, createdAt: '2026-05-19 14:23:10', startedAt: '2026-05-19 14:23:11', completedAt: '2026-05-19 14:23:45', inputParams: { prompt: 'a serene mountain lake at sunset', negative_prompt: 'blurry, low quality', width: 1024, height: 1024, steps: 30, guidance_scale: 7.5 }, outputUrl: 'https://output.aivastra.ai/j_a1b2c3d4.png' },
  { id: 'j_b2c3d4e5', user: 'karim.m@cairo-cut.eg', type: 'txt2img', model: 'SD 3.5', worker: 'wrk-7af2-eu-2', status: 'COMPLETED', duration: '42.7s', creditsCost: 30, priority: 0, createdAt: '2026-05-19 14:10:00', startedAt: '2026-05-19 14:10:02', completedAt: '2026-05-19 14:10:44', inputParams: { prompt: 'ancient egyptian temple interior with hieroglyphics', width: 1024, height: 1024, steps: 35, guidance_scale: 6.0 }, outputUrl: 'https://output.aivastra.ai/j_b2c3d4e5.png' },
  { id: 'j_c3d4e5f6', user: 'lior@studio-lb.co.il', type: 'txt2img', model: 'Flux Pro', worker: 'wrk-7af2-eu-3', status: 'COMPLETED', duration: '55.1s', creditsCost: 50, priority: 0, createdAt: '2026-05-19 13:50:30', completedAt: '2026-05-19 13:51:25', inputParams: { prompt: 'photorealistic portrait of an elderly fisherman with weathered skin', width: 1024, height: 1280, steps: 40, guidance_scale: 3.5 }, outputUrl: 'https://output.aivastra.ai/j_c3d4e5f6.png' },
  { id: 'j_d4e5f6g7', user: 'aisha@visual-stories.in', type: 'img2img', model: 'SDXL 1.0', worker: 'wrk-7af2-eu-1', status: 'COMPLETED', duration: '28.9s', creditsCost: 25, priority: 0, createdAt: '2026-05-19 13:22:15', completedAt: '2026-05-19 13:22:44', inputParams: { prompt: 'convert to watercolor painting style', strength: 0.75, steps: 25 }, outputUrl: 'https://output.aivastra.ai/j_d4e5f6g7.png' },
  { id: 'j_e4d5c6b7', user: 'felix@marchetti.tn', type: 'txt2img', model: 'SDXL 1.0', worker: null, status: 'QUEUED', duration: '', creditsCost: 25, priority: 2, createdAt: '2026-05-19 14:25:00', inputParams: { prompt: 'cyberpunk city street at night with neon signs' } },
  { id: 'j_b7a6c5d4', user: 'oliver@berlin-gen.ai', type: 'txt2img', model: 'Flux Pro', worker: 'wrk-7af2-us-1', status: 'GENERATING', duration: '12.4s', creditsCost: 50, priority: 1, createdAt: '2026-05-19 14:20:00', startedAt: '2026-05-19 14:24:10', inputParams: { prompt: 'minimalist scandinavian living room with natural light', width: 2048, height: 2048, steps: 30 } },
  { id: 'j_f7c2a4b1', user: 'felix@marchetti.tn', type: 'txt2img', model: 'SDXL 1.0', worker: 'wrk-7af2-eu-1', status: 'FAILED', duration: '18.3s', creditsCost: 0, priority: 0, createdAt: '2026-05-19 13:45:00', startedAt: '2026-05-19 13:45:01', error: 'Model output dimension mismatch: expected (1, 4, 128, 128) got (1, 4, 127, 128)' },
  { id: 'j_k8e2d4c3', user: 'karim.m@cairo-cut.eg', type: 'img2img', model: 'SD 3.5', worker: 'wrk-7af2-eu-2', status: 'FAILED', duration: '45.2s', creditsCost: 0, priority: 0, createdAt: '2026-05-19 12:30:00', startedAt: '2026-05-19 12:30:02', error: 'R2 upload timeout after 30s' },
  { id: 'j_g8h2i4j6', user: 'sarah@seoul-studio.kr', type: 'txt2img', model: 'SDXL 1.0', worker: 'wrk-7af2-us-2', status: 'CANCELLED', duration: '5.1s', creditsCost: 0, priority: 0, createdAt: '2026-05-19 11:00:00' },
  { id: 'j_h9i0j1k2', user: 'maria@barcelona-art.es', type: 'txt2img', model: 'SD Turbo', worker: 'wrk-7af2-eu-3', status: 'COMPLETED', duration: '3.2s', creditsCost: 5, priority: 0, createdAt: '2026-05-19 14:22:00', completedAt: '2026-05-19 14:22:03', inputParams: { prompt: 'concept art of a futuristic drone', steps: 4, guidance_scale: 2.0 }, outputUrl: 'https://output.aivastra.ai/j_h9i0j1k2.png' },
  { id: 'j_i1j2k3l4', user: 'yuki@tokyo-pixel.jp', type: 'controlnet', model: 'SDXL 1.0', worker: 'wrk-7af2-eu-1', status: 'COMPLETED', duration: '38.7s', creditsCost: 30, priority: 0, createdAt: '2026-05-19 13:00:00', completedAt: '2026-05-19 13:00:38', inputParams: { prompt: 'samurai in bamboo forest', control_type: 'canny', control_strength: 0.8, width: 1024, height: 1024 }, outputUrl: 'https://output.aivastra.ai/j_i1j2k3l4.png' },
  { id: 'j_j2k3l4m5', user: 'tariq@dubai-frame.ae', type: 'txt2img', model: 'Flux Pro', worker: 'wrk-7af2-us-1', status: 'QUEUED', duration: '', creditsCost: 50, priority: 0, createdAt: '2026-05-19 14:27:00', inputParams: { prompt: 'modern desert villa with infinity pool at golden hour' } },
  { id: 'j_k3l4m5n6', user: 'chen.w@shanghai-ai.cn', type: 'img2img', model: 'SD 3.5', worker: null, status: 'QUEUED', duration: '', creditsCost: 30, priority: 0, createdAt: '2026-05-19 14:28:00', inputParams: { prompt: 'convert architectural sketch to realistic render', strength: 0.85 } },
  { id: 'j_l4m5n6o7', user: 'oliver@berlin-gen.ai', type: 'txt2img', model: 'SDXL 1.0', worker: 'wrk-7af2-eu-2', status: 'UPLOADING', duration: '22.8s', creditsCost: 25, priority: 0, createdAt: '2026-05-19 14:15:00', startedAt: '2026-05-19 14:24:15', inputParams: { prompt: 'brutalist architecture interior with dramatic shadows' } },
];

// ── API client ──────────────────────────────────────────────────────────────

let _token: string | null = null;
let _onAuthFailure: (() => void) | null = null;

export function setToken(t: string | null) { _token = t; }
export function getToken() { return _token; }
export function initAuthFailureHandler(cb: () => void) { _onAuthFailure = cb; }

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const makeHeaders = (token: string | null): HeadersInit => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> ?? {}),
  });

  const res = await fetch(path, { ...init, headers: makeHeaders(_token), credentials: 'include' });

  if (res.status === 401 && _token) {
    const refreshRes = await fetch('/v1/auth/refresh', { method: 'POST', credentials: 'include' });
    if (refreshRes.ok) {
      const { accessToken } = await refreshRes.json() as { accessToken: string };
      setToken(accessToken);
      const retry = await fetch(path, { ...init, headers: makeHeaders(accessToken), credentials: 'include' });
      if (!retry.ok) throw new ApiError(retry.status, await retry.json());
      return retry.json() as Promise<T>;
    }
    setToken(null);
    _onAuthFailure?.();
    throw new ApiError(401, { error: { code: 'SESSION_EXPIRED', message: 'session expired' } });
  }

  if (!res.ok) throw new ApiError(res.status, await res.json());
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
