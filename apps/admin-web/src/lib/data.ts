import type { CatalogItem, ModelBackground, ModelFace, ModelPose, Stats } from '../types';

export const TONES = [
  'oklch(0.86 0.04 60)',
  'oklch(0.72 0.08 35)',
  'oklch(0.58 0.06 30)',
  'oklch(0.40 0.02 270)',
  'oklch(0.82 0.03 90)',
  'oklch(0.68 0.08 110)',
];

export const STATUS_ORDER = [
  'QUEUED',
  'PREPROCESSING',
  'GENERATING',
  'UPLOADING',
  'COMPLETED',
] as const;

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
  {
    id: 'face_men_01',
    gender: 'men',
    label: 'Male Model A',
    thumbnailKey: 'faces/men-01-thumb.jpg',
    r2Key: 'faces/men-01.jpg',
    faceSideR2Key: null,
    isActive: true,
    sortOrder: 0,
    createdAt: '2026-05-01T10:00:00Z',
    updatedAt: '2026-05-01T10:00:00Z',
    deletedAt: null,
  },
  {
    id: 'face_men_02',
    gender: 'men',
    label: 'Male Model B',
    thumbnailKey: 'faces/men-02-thumb.jpg',
    r2Key: 'faces/men-02.jpg',
    faceSideR2Key: null,
    isActive: true,
    sortOrder: 1,
    createdAt: '2026-05-02T10:00:00Z',
    updatedAt: '2026-05-02T10:00:00Z',
    deletedAt: null,
  },
  {
    id: 'face_women_01',
    gender: 'women',
    label: 'Female Model A',
    thumbnailKey: 'faces/women-01-thumb.jpg',
    r2Key: 'faces/women-01.jpg',
    faceSideR2Key: null,
    isActive: true,
    sortOrder: 0,
    createdAt: '2026-05-03T10:00:00Z',
    updatedAt: '2026-05-03T10:00:00Z',
    deletedAt: null,
  },
  {
    id: 'face_women_02',
    gender: 'women',
    label: 'Female Model B',
    thumbnailKey: 'faces/women-02-thumb.jpg',
    r2Key: 'faces/women-02.jpg',
    faceSideR2Key: null,
    isActive: false,
    sortOrder: 1,
    createdAt: '2026-05-04T10:00:00Z',
    updatedAt: '2026-05-04T10:00:00Z',
    deletedAt: null,
  },
  {
    id: 'face_boys_01',
    gender: 'boys',
    label: 'Boys Model A',
    thumbnailKey: 'faces/boys-01-thumb.jpg',
    r2Key: 'faces/boys-01.jpg',
    faceSideR2Key: null,
    isActive: true,
    sortOrder: 0,
    createdAt: '2026-05-05T10:00:00Z',
    updatedAt: '2026-05-05T10:00:00Z',
    deletedAt: null,
  },
  {
    id: 'face_girls_01',
    gender: 'girls',
    label: 'Girls Model A',
    thumbnailKey: 'faces/girls-01-thumb.jpg',
    r2Key: 'faces/girls-01.jpg',
    faceSideR2Key: null,
    isActive: true,
    sortOrder: 0,
    createdAt: '2026-05-05T10:00:00Z',
    updatedAt: '2026-05-05T10:00:00Z',
    deletedAt: null,
  },
];

export const MOCK_BACKGROUNDS: ModelBackground[] = [
  {
    id: 'bg_001',
    label: 'Studio White',
    thumbnailKey: 'bgs/studio-white-thumb.jpg',
    r2Key: 'bgs/studio-white.jpg',
    bgComfyR2Key: null,
    categoryId: null,
    tags: [],
    specialTag: null,
    isActive: true,
    isWhiteBg: true,
    sortOrder: 0,
    genderSlug: null,
    scope: 'general',
    createdAt: '2026-05-06T10:00:00Z',
    updatedAt: '2026-05-06T10:00:00Z',
    deletedAt: null,
  },
  {
    id: 'bg_002',
    label: 'Urban Street',
    thumbnailKey: 'bgs/urban-thumb.jpg',
    r2Key: 'bgs/urban.jpg',
    bgComfyR2Key: null,
    categoryId: null,
    tags: [],
    specialTag: null,
    isActive: true,
    isWhiteBg: false,
    sortOrder: 1,
    genderSlug: 'men',
    scope: 'general',
    createdAt: '2026-05-06T11:00:00Z',
    updatedAt: '2026-05-06T11:00:00Z',
    deletedAt: null,
  },
  {
    id: 'bg_003',
    label: 'Office',
    thumbnailKey: 'bgs/office-thumb.jpg',
    r2Key: 'bgs/office.jpg',
    bgComfyR2Key: null,
    categoryId: null,
    tags: [],
    specialTag: null,
    isActive: true,
    isWhiteBg: false,
    sortOrder: 2,
    genderSlug: null,
    scope: 'general',
    createdAt: '2026-05-07T10:00:00Z',
    updatedAt: '2026-05-07T10:00:00Z',
    deletedAt: null,
  },
  {
    id: 'bg_004',
    label: 'Studio Grey',
    thumbnailKey: 'bgs/studio-grey-thumb.jpg',
    r2Key: 'bgs/studio-grey.jpg',
    bgComfyR2Key: null,
    categoryId: null,
    tags: [],
    specialTag: null,
    isActive: true,
    isWhiteBg: false,
    sortOrder: 3,
    genderSlug: null,
    scope: 'general',
    createdAt: '2026-05-06T10:00:00Z',
    updatedAt: '2026-05-06T10:00:00Z',
    deletedAt: null,
  },
];

export const MOCK_POSES: ModelPose[] = [
  {
    id: 'pose_001',
    garmentTypeId: 'sub_men_shirt',
    faceId: 'face_001',
    backgroundId: 'bg_001',
    label: 'm1bg1p1',
    thumbnailKey: 'poses/m1bg1p1-thumb.jpg',
    r2Key: 'poses/m1bg1p1.jpg',
    faceSideR2Key: null,
    bgComfyR2Key: null,
    workflowTemplateId: '',
    workflowLabel: null,
    promptFacePhase: null,
    promptGarmentPhase: null,
    showsLower: true,
    showsShoes: true,
    isActive: true,
    sortOrder: 0,
    createdAt: '2026-05-10T10:00:00Z',
    updatedAt: '2026-05-10T10:00:00Z',
  },
  {
    id: 'pose_002',
    garmentTypeId: 'sub_men_shirt',
    faceId: 'face_001',
    backgroundId: 'bg_001',
    label: 'm1bg1p2',
    thumbnailKey: 'poses/m1bg1p2-thumb.jpg',
    r2Key: 'poses/m1bg1p2.jpg',
    faceSideR2Key: null,
    bgComfyR2Key: null,
    workflowTemplateId: '',
    workflowLabel: null,
    promptFacePhase: null,
    promptGarmentPhase: null,
    showsLower: true,
    showsShoes: false,
    isActive: true,
    sortOrder: 1,
    createdAt: '2026-05-10T11:00:00Z',
    updatedAt: '2026-05-10T11:00:00Z',
  },
  {
    id: 'pose_003',
    garmentTypeId: 'sub_men_shirt',
    faceId: 'face_001',
    backgroundId: 'bg_002',
    label: 'm1bg2p1',
    thumbnailKey: 'poses/m1bg2p1-thumb.jpg',
    r2Key: 'poses/m1bg2p1.jpg',
    faceSideR2Key: null,
    bgComfyR2Key: null,
    workflowTemplateId: '',
    workflowLabel: null,
    promptFacePhase: null,
    promptGarmentPhase: null,
    showsLower: false,
    showsShoes: false,
    isActive: true,
    sortOrder: 2,
    createdAt: '2026-05-10T12:00:00Z',
    updatedAt: '2026-05-10T12:00:00Z',
  },
];

export const MOCK_CATALOG: CatalogItem[] = [
  {
    id: 'cat_lower_001',
    label: 'Classic Blue Jeans',
    type: 'lower',
    genderSlug: 'men',
    thumbnailKey: 'catalog/lower-jeans-001-thumb.jpg',
    r2Key: 'catalog/lower-jeans-001.jpg',
    categoryId: null,
    subcategoryIds: [],
    isActive: true,
    sortOrder: 0,
    createdAt: '2026-05-01T10:00:00Z',
    updatedAt: '2026-05-01T10:00:00Z',
  },
  {
    id: 'cat_lower_002',
    label: 'Slim Fit Chinos',
    type: 'lower',
    genderSlug: 'men',
    thumbnailKey: 'catalog/lower-chinos-001-thumb.jpg',
    r2Key: 'catalog/lower-chinos-001.jpg',
    categoryId: null,
    subcategoryIds: [],
    isActive: true,
    sortOrder: 1,
    createdAt: '2026-05-02T10:00:00Z',
    updatedAt: '2026-05-02T10:00:00Z',
  },
  {
    id: 'cat_lower_003',
    label: 'Formal Trousers Black',
    type: 'lower',
    genderSlug: 'men',
    thumbnailKey: 'catalog/lower-formal-001-thumb.jpg',
    r2Key: 'catalog/lower-formal-001.jpg',
    categoryId: null,
    subcategoryIds: [],
    isActive: true,
    sortOrder: 2,
    createdAt: '2026-05-03T10:00:00Z',
    updatedAt: '2026-05-03T10:00:00Z',
  },
  {
    id: 'cat_lower_004',
    label: 'Track Pants Grey',
    type: 'lower',
    genderSlug: 'men',
    thumbnailKey: 'catalog/lower-track-001-thumb.jpg',
    r2Key: 'catalog/lower-track-001.jpg',
    categoryId: null,
    subcategoryIds: [],
    isActive: false,
    sortOrder: 3,
    createdAt: '2026-05-04T10:00:00Z',
    updatedAt: '2026-05-04T10:00:00Z',
  },
  {
    id: 'cat_shoe_001',
    label: 'White Sneakers',
    type: 'shoe',
    genderSlug: 'men',
    thumbnailKey: 'catalog/shoe-sneaker-001-thumb.jpg',
    r2Key: 'catalog/shoe-sneaker-001.jpg',
    categoryId: null,
    subcategoryIds: [],
    isActive: true,
    sortOrder: 0,
    createdAt: '2026-05-01T10:00:00Z',
    updatedAt: '2026-05-01T10:00:00Z',
  },
  {
    id: 'cat_shoe_002',
    label: 'Oxford Brown',
    type: 'shoe',
    genderSlug: 'men',
    thumbnailKey: 'catalog/shoe-oxford-001-thumb.jpg',
    r2Key: 'catalog/shoe-oxford-001.jpg',
    categoryId: null,
    subcategoryIds: [],
    isActive: true,
    sortOrder: 1,
    createdAt: '2026-05-02T10:00:00Z',
    updatedAt: '2026-05-02T10:00:00Z',
  },
  {
    id: 'cat_shoe_003',
    label: 'Loafers Tan',
    type: 'shoe',
    genderSlug: 'men',
    thumbnailKey: 'catalog/shoe-loafer-001-thumb.jpg',
    r2Key: 'catalog/shoe-loafer-001.jpg',
    categoryId: null,
    subcategoryIds: [],
    isActive: true,
    sortOrder: 2,
    createdAt: '2026-05-03T10:00:00Z',
    updatedAt: '2026-05-03T10:00:00Z',
  },
];

// ── API client ──────────────────────────────────────────────────────────────

let _token: string | null = null;
let _onAuthFailure: (() => void) | null = null;

export function setToken(t: string | null) {
  _token = t;
}
export function getToken() {
  return _token;
}
export function initAuthFailureHandler(cb: () => void) {
  _onAuthFailure = cb;
}

export class ApiError extends Error {
  public readonly code: string | undefined;

  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(apiErrorBodyMessage(body) ?? httpStatusMessage(status));
    this.name = 'ApiError';
    this.code = apiErrorBodyCode(body);
  }
}

type ApiErrorBody = {
  error?: { code?: unknown; message?: unknown } | string;
  message?: unknown;
};

function apiErrorBodyMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = body as ApiErrorBody;
  const message =
    typeof value.error === 'object' && value.error !== null
      ? value.error.message
      : typeof value.error === 'string'
        ? value.error
        : value.message;
  return typeof message === 'string' && message.trim() ? message.trim() : undefined;
}

function apiErrorBodyCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const error = (body as ApiErrorBody).error;
  if (!error || typeof error !== 'object') return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function httpStatusMessage(status: number): string {
  switch (status) {
    case 400:
    case 422:
      return 'Some information is invalid. Check the form and try again.';
    case 401:
      return 'Your session has expired. Sign in again.';
    case 403:
      return 'You do not have permission to perform this action.';
    case 404:
      return 'The requested item could not be found.';
    case 409:
      return 'This action conflicts with the current state. Refresh and try again.';
    case 413:
      return 'The selected file is too large.';
    case 429:
      return 'Too many requests. Wait a moment and try again.';
    case 502:
    case 503:
    case 504:
      return 'The service is temporarily unavailable. Try again shortly.';
    default:
      return status >= 500
        ? 'Something went wrong on the server. Try again.'
        : 'The request could not be completed. Try again.';
  }
}

export function uploadErrorMessage(status: number): string {
  switch (status) {
    case 403:
      return 'The upload authorization expired. Start the upload again.';
    case 413:
      return 'The selected file is too large.';
    case 429:
      return 'Too many uploads. Wait a moment and try again.';
    case 500:
    case 502:
    case 503:
    case 504:
      return 'The storage service is temporarily unavailable. Try again shortly.';
    default:
      return 'The file could not be uploaded. Try again.';
  }
}

export const UPLOAD_NETWORK_ERROR =
  'Unable to upload the file. Check your connection and try again.';

export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

async function fetchApi(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error('Unable to reach the server. Check your connection and try again.', {
      cause: err,
    });
  }
}

async function readResponseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  return new ApiError(res.status, await readResponseBody(res));
}

async function readApiResponse<T>(res: Response): Promise<T> {
  if (!res.ok) throw await apiErrorFromResponse(res);
  return (await readResponseBody(res)) as T;
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const makeHeaders = (token: string | null): HeadersInit => ({
    ...(init.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  });

  const res = await fetchApi(path, {
    ...init,
    headers: makeHeaders(_token),
    credentials: 'include',
  });

  if (res.status === 401 && _token) {
    const refreshRes = await fetchApi('/admin/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (refreshRes.ok) {
      const { accessToken } = await readApiResponse<{ accessToken: string }>(refreshRes);
      setToken(accessToken);
      const retry = await fetchApi(path, {
        ...init,
        headers: makeHeaders(accessToken),
        credentials: 'include',
      });
      return readApiResponse<T>(retry);
    }
    setToken(null);
    _onAuthFailure?.();
    throw new ApiError(401, {
      error: { code: 'SESSION_EXPIRED', message: 'Your session has expired. Sign in again.' },
    });
  }

  return readApiResponse<T>(res);
}

export async function patchAdminPreferences(preferences: { theme?: 'light' | 'dark' | 'system' }) {
  return apiFetch<{ preferences: { theme?: 'light' | 'dark' | 'system' } }>(
    '/admin/me/preferences',
    {
      method: 'PATCH',
      body: JSON.stringify(preferences),
    },
  );
}
