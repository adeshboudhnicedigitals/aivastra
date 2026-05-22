import type { Stats, CatalogItem, ModelFace, ModelBackground, ModelPose } from '../types';

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


export const MOCK_FACES: ModelFace[] = [
  { id: 'face_men_01', gender: 'men', label: 'Male Model A', thumbnailKey: 'faces/men-01-thumb.jpg', r2Key: 'faces/men-01.jpg', isActive: true, sortOrder: 0, createdAt: '2026-05-01T10:00:00Z', updatedAt: '2026-05-01T10:00:00Z', templateCount: 3 },
  { id: 'face_men_02', gender: 'men', label: 'Male Model B', thumbnailKey: 'faces/men-02-thumb.jpg', r2Key: 'faces/men-02.jpg', isActive: true, sortOrder: 1, createdAt: '2026-05-02T10:00:00Z', updatedAt: '2026-05-02T10:00:00Z', templateCount: 2 },
  { id: 'face_women_01', gender: 'women', label: 'Female Model A', thumbnailKey: 'faces/women-01-thumb.jpg', r2Key: 'faces/women-01.jpg', isActive: true, sortOrder: 0, createdAt: '2026-05-03T10:00:00Z', updatedAt: '2026-05-03T10:00:00Z', templateCount: 4 },
  { id: 'face_women_02', gender: 'women', label: 'Female Model B', thumbnailKey: 'faces/women-02-thumb.jpg', r2Key: 'faces/women-02.jpg', isActive: false, sortOrder: 1, createdAt: '2026-05-04T10:00:00Z', updatedAt: '2026-05-04T10:00:00Z', templateCount: 1 },
  { id: 'face_boys_01', gender: 'boys', label: 'Boys Model A', thumbnailKey: 'faces/boys-01-thumb.jpg', r2Key: 'faces/boys-01.jpg', isActive: true, sortOrder: 0, createdAt: '2026-05-05T10:00:00Z', updatedAt: '2026-05-05T10:00:00Z', templateCount: 2 },
  { id: 'face_girls_01', gender: 'girls', label: 'Girls Model A', thumbnailKey: 'faces/girls-01-thumb.jpg', r2Key: 'faces/girls-01.jpg', isActive: true, sortOrder: 0, createdAt: '2026-05-05T10:00:00Z', updatedAt: '2026-05-05T10:00:00Z', templateCount: 2 },
];

export const MOCK_BACKGROUNDS: ModelBackground[] = [
  { id: 'bg_001', label: 'Studio White', thumbnailKey: 'bgs/studio-white-thumb.jpg', r2Key: 'bgs/studio-white.jpg', isActive: true, sortOrder: 0, createdAt: '2026-05-06T10:00:00Z', updatedAt: '2026-05-06T10:00:00Z' },
  { id: 'bg_002', label: 'Urban Street', thumbnailKey: 'bgs/urban-thumb.jpg', r2Key: 'bgs/urban.jpg', isActive: true, sortOrder: 1, createdAt: '2026-05-06T11:00:00Z', updatedAt: '2026-05-06T11:00:00Z' },
  { id: 'bg_003', label: 'Office', thumbnailKey: 'bgs/office-thumb.jpg', r2Key: 'bgs/office.jpg', isActive: true, sortOrder: 2, createdAt: '2026-05-07T10:00:00Z', updatedAt: '2026-05-07T10:00:00Z' },
  { id: 'bg_004', label: 'Studio Grey', thumbnailKey: 'bgs/studio-grey-thumb.jpg', r2Key: 'bgs/studio-grey.jpg', isActive: true, sortOrder: 3, createdAt: '2026-05-06T10:00:00Z', updatedAt: '2026-05-06T10:00:00Z' },
];

export const MOCK_POSES: ModelPose[] = [
  { id: 'pose_001', subcategoryId: 'sub_men_shirt', faceId: 'face_001', backgroundId: 'bg_001', label: 'm1bg1p1', thumbnailKey: 'poses/m1bg1p1-thumb.jpg', r2Key: 'poses/m1bg1p1.jpg', showsLower: true, showsShoes: true, isActive: true, sortOrder: 0, createdAt: '2026-05-10T10:00:00Z', updatedAt: '2026-05-10T10:00:00Z' },
  { id: 'pose_002', subcategoryId: 'sub_men_shirt', faceId: 'face_001', backgroundId: 'bg_001', label: 'm1bg1p2', thumbnailKey: 'poses/m1bg1p2-thumb.jpg', r2Key: 'poses/m1bg1p2.jpg', showsLower: true, showsShoes: false, isActive: true, sortOrder: 1, createdAt: '2026-05-10T11:00:00Z', updatedAt: '2026-05-10T11:00:00Z' },
  { id: 'pose_003', subcategoryId: 'sub_men_shirt', faceId: 'face_001', backgroundId: 'bg_002', label: 'm1bg2p1', thumbnailKey: 'poses/m1bg2p1-thumb.jpg', r2Key: 'poses/m1bg2p1.jpg', showsLower: false, showsShoes: false, isActive: true, sortOrder: 2, createdAt: '2026-05-10T12:00:00Z', updatedAt: '2026-05-10T12:00:00Z' },
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
    ...(init.body != null ? { 'Content-Type': 'application/json' } : {}),
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
