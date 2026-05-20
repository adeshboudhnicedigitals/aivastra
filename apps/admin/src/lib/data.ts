import type { Stats, CatalogItem, User, Job, ModelFace, ModelBackground, ModelPose } from '../types';

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
  { id: 'u_h4i5j6', name: 'Suspended User', email: 'suspended@example.com', role: 'CREATOR', plan: 'Starter', creditsRemaining: 0, creditLimit: 5000, totalJobs: 45, joinedAt: '2026-01-10', lastActive: '2026-04-30 08:12', emailVerified: true, status: 'suspended' },
];

export const MOCK_FACES: ModelFace[] = [
  { id: 'face_men_01', gender: 'men', label: 'Male Model A', thumbnailKey: 'faces/men-01-thumb.jpg', r2Key: 'faces/men-01.jpg', isActive: true, sortOrder: 0, createdAt: '2026-05-01T10:00:00Z', updatedAt: '2026-05-01T10:00:00Z', backgroundCount: 3 },
  { id: 'face_men_02', gender: 'men', label: 'Male Model B', thumbnailKey: 'faces/men-02-thumb.jpg', r2Key: 'faces/men-02.jpg', isActive: true, sortOrder: 1, createdAt: '2026-05-02T10:00:00Z', updatedAt: '2026-05-02T10:00:00Z', backgroundCount: 2 },
  { id: 'face_women_01', gender: 'women', label: 'Female Model A', thumbnailKey: 'faces/women-01-thumb.jpg', r2Key: 'faces/women-01.jpg', isActive: true, sortOrder: 0, createdAt: '2026-05-03T10:00:00Z', updatedAt: '2026-05-03T10:00:00Z', backgroundCount: 4 },
  { id: 'face_women_02', gender: 'women', label: 'Female Model B', thumbnailKey: 'faces/women-02-thumb.jpg', r2Key: 'faces/women-02.jpg', isActive: false, sortOrder: 1, createdAt: '2026-05-04T10:00:00Z', updatedAt: '2026-05-04T10:00:00Z', backgroundCount: 1 },
  { id: 'face_boys_01', gender: 'boys', label: 'Boys Model A', thumbnailKey: 'faces/boys-01-thumb.jpg', r2Key: 'faces/boys-01.jpg', isActive: true, sortOrder: 0, createdAt: '2026-05-05T10:00:00Z', updatedAt: '2026-05-05T10:00:00Z', backgroundCount: 2 },
  { id: 'face_girls_01', gender: 'girls', label: 'Girls Model A', thumbnailKey: 'faces/girls-01-thumb.jpg', r2Key: 'faces/girls-01.jpg', isActive: true, sortOrder: 0, createdAt: '2026-05-05T10:00:00Z', updatedAt: '2026-05-05T10:00:00Z', backgroundCount: 2 },
];

export const MOCK_BACKGROUNDS: ModelBackground[] = [
  { id: 'bg_men01_01', faceId: 'face_men_01', faceLabel: 'Male Model A', label: 'Studio White', thumbnailKey: 'bgs/men01-studio-white-thumb.jpg', r2Key: 'bgs/men01-studio-white.jpg', isActive: true, sortOrder: 0, createdAt: '2026-05-06T10:00:00Z', updatedAt: '2026-05-06T10:00:00Z', poseCount: 3 },
  { id: 'bg_men01_02', faceId: 'face_men_01', faceLabel: 'Male Model A', label: 'Urban Street', thumbnailKey: 'bgs/men01-urban-thumb.jpg', r2Key: 'bgs/men01-urban.jpg', isActive: true, sortOrder: 1, createdAt: '2026-05-06T11:00:00Z', updatedAt: '2026-05-06T11:00:00Z', poseCount: 2 },
  { id: 'bg_men01_03', faceId: 'face_men_01', faceLabel: 'Male Model A', label: 'Office', thumbnailKey: 'bgs/men01-office-thumb.jpg', r2Key: 'bgs/men01-office.jpg', isActive: true, sortOrder: 2, createdAt: '2026-05-07T10:00:00Z', updatedAt: '2026-05-07T10:00:00Z', poseCount: 3 },
  { id: 'bg_men02_01', faceId: 'face_men_02', faceLabel: 'Male Model B', label: 'Studio Grey', thumbnailKey: 'bgs/men02-studio-grey-thumb.jpg', r2Key: 'bgs/men02-studio-grey.jpg', isActive: true, sortOrder: 0, createdAt: '2026-05-06T10:00:00Z', updatedAt: '2026-05-06T10:00:00Z', poseCount: 3 },
  { id: 'bg_women01_01', faceId: 'face_women_01', faceLabel: 'Female Model A', label: 'Studio White', thumbnailKey: 'bgs/women01-studio-white-thumb.jpg', r2Key: 'bgs/women01-studio-white.jpg', isActive: true, sortOrder: 0, createdAt: '2026-05-06T10:00:00Z', updatedAt: '2026-05-06T10:00:00Z', poseCount: 3 },
];

export const MOCK_POSES: ModelPose[] = [
  { id: 'pose_men01bg01_01', backgroundId: 'bg_men01_01', backgroundLabel: 'Studio White', label: 'Front Stand', thumbnailKey: 'poses/m1b1-front-thumb.jpg', r2Key: 'poses/m1b1-front.jpg', showsLower: true, showsShoes: true, isActive: true, sortOrder: 0, createdAt: '2026-05-10T10:00:00Z', updatedAt: '2026-05-10T10:00:00Z' },
  { id: 'pose_men01bg01_02', backgroundId: 'bg_men01_01', backgroundLabel: 'Studio White', label: 'Half Turn', thumbnailKey: 'poses/m1b1-half-thumb.jpg', r2Key: 'poses/m1b1-half.jpg', showsLower: true, showsShoes: false, isActive: true, sortOrder: 1, createdAt: '2026-05-10T11:00:00Z', updatedAt: '2026-05-10T11:00:00Z' },
  { id: 'pose_men01bg01_03', backgroundId: 'bg_men01_01', backgroundLabel: 'Studio White', label: 'Upper Only', thumbnailKey: 'poses/m1b1-upper-thumb.jpg', r2Key: 'poses/m1b1-upper.jpg', showsLower: false, showsShoes: false, isActive: true, sortOrder: 2, createdAt: '2026-05-10T12:00:00Z', updatedAt: '2026-05-10T12:00:00Z' },
];

export const MOCK_CATALOG: CatalogItem[] = [
  { id: 'cat_lower_001', label: 'Classic Blue Jeans', type: 'lower', thumbnailKey: 'catalog/lower-jeans-001-thumb.jpg', isActive: true, sortOrder: 0, createdAt: '2026-05-01T10:00:00Z', updatedAt: '2026-05-01T10:00:00Z' },
  { id: 'cat_lower_002', label: 'Slim Fit Chinos', type: 'lower', thumbnailKey: 'catalog/lower-chinos-001-thumb.jpg', isActive: true, sortOrder: 1, createdAt: '2026-05-02T10:00:00Z', updatedAt: '2026-05-02T10:00:00Z' },
  { id: 'cat_lower_003', label: 'Formal Trousers Black', type: 'lower', thumbnailKey: 'catalog/lower-formal-001-thumb.jpg', isActive: true, sortOrder: 2, createdAt: '2026-05-03T10:00:00Z', updatedAt: '2026-05-03T10:00:00Z' },
  { id: 'cat_lower_004', label: 'Track Pants Grey', type: 'lower', thumbnailKey: 'catalog/lower-track-001-thumb.jpg', isActive: false, sortOrder: 3, createdAt: '2026-05-04T10:00:00Z', updatedAt: '2026-05-04T10:00:00Z' },
  { id: 'cat_shoe_001', label: 'White Sneakers', type: 'shoe', thumbnailKey: 'catalog/shoe-sneaker-001-thumb.jpg', isActive: true, sortOrder: 0, createdAt: '2026-05-01T10:00:00Z', updatedAt: '2026-05-01T10:00:00Z' },
  { id: 'cat_shoe_002', label: 'Oxford Brown', type: 'shoe', thumbnailKey: 'catalog/shoe-oxford-001-thumb.jpg', isActive: true, sortOrder: 1, createdAt: '2026-05-02T10:00:00Z', updatedAt: '2026-05-02T10:00:00Z' },
  { id: 'cat_shoe_003', label: 'Loafers Tan', type: 'shoe', thumbnailKey: 'catalog/shoe-loafer-001-thumb.jpg', isActive: true, sortOrder: 2, createdAt: '2026-05-03T10:00:00Z', updatedAt: '2026-05-03T10:00:00Z' },
];

export const MOCK_JOBS: Job[] = [
  { id: 'j_a1b2c3d4', userEmail: 'felix@marchetti.tn', status: 'COMPLETED', priority: true, creditsCharged: 1, workerId: 'worker-a', createdAt: '2026-05-19 14:23:10', startedAt: '2026-05-19 14:23:11', completedAt: '2026-05-19 14:23:45', faceLabel: 'Male Model A', backgroundLabel: 'Studio White', poseLabel: 'Front Stand', hasLower: true, hasShoe: true, outputUrl: 'https://output.aivastra.ai/j_a1b2c3d4.png' },
  { id: 'j_b2c3d4e5', userEmail: 'karim.m@cairo-cut.eg', status: 'COMPLETED', priority: false, creditsCharged: 1, workerId: 'worker-a', createdAt: '2026-05-19 14:10:00', startedAt: '2026-05-19 14:10:02', completedAt: '2026-05-19 14:10:44', faceLabel: 'Female Model A', backgroundLabel: 'Studio White', poseLabel: 'Half Turn', hasLower: true, hasShoe: false, outputUrl: 'https://output.aivastra.ai/j_b2c3d4e5.png' },
  { id: 'j_e4d5c6b7', userEmail: 'felix@marchetti.tn', status: 'QUEUED', priority: true, creditsCharged: 1, workerId: null, createdAt: '2026-05-19 14:25:00', faceLabel: 'Male Model B', backgroundLabel: 'Studio Grey', poseLabel: 'Front Stand', hasLower: false, hasShoe: false },
  { id: 'j_b7a6c5d4', userEmail: 'oliver@berlin-gen.ai', status: 'GENERATING', priority: true, creditsCharged: 1, workerId: 'worker-a', createdAt: '2026-05-19 14:20:00', startedAt: '2026-05-19 14:24:10', faceLabel: 'Female Model A', backgroundLabel: 'Urban Street', poseLabel: 'Upper Only', hasLower: false, hasShoe: false },
  { id: 'j_f7c2a4b1', userEmail: 'felix@marchetti.tn', status: 'FAILED', priority: false, creditsCharged: 0, workerId: 'worker-a', createdAt: '2026-05-19 13:45:00', startedAt: '2026-05-19 13:45:01', errorCode: 'COMFY_TIMEOUT', faceLabel: 'Male Model A', backgroundLabel: 'Office', poseLabel: 'Half Turn', hasLower: true, hasShoe: false },
  { id: 'j_k8e2d4c3', userEmail: 'karim.m@cairo-cut.eg', status: 'FAILED', priority: false, creditsCharged: 0, workerId: 'worker-a', createdAt: '2026-05-19 12:30:00', startedAt: '2026-05-19 12:30:02', errorCode: 'R2_UPLOAD_TIMEOUT', faceLabel: 'Female Model A', backgroundLabel: 'Studio White', poseLabel: 'Front Stand', hasLower: false, hasShoe: false },
  { id: 'j_g8h2i4j6', userEmail: 'sarah@seoul-studio.kr', status: 'CANCELLED', priority: false, creditsCharged: 0, workerId: null, createdAt: '2026-05-19 11:00:00', faceLabel: 'Boys Model A', backgroundLabel: 'Studio White', poseLabel: 'Front Stand', hasLower: true, hasShoe: true },
  { id: 'j_j2k3l4m5', userEmail: 'tariq@dubai-frame.ae', status: 'QUEUED', priority: false, creditsCharged: 1, workerId: null, createdAt: '2026-05-19 14:27:00', faceLabel: 'Female Model A', backgroundLabel: 'Studio White', poseLabel: 'Front Stand', hasLower: false, hasShoe: false },
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
