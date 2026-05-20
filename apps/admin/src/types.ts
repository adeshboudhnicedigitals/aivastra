export type GenderSlug = 'men' | 'women' | 'boys' | 'girls';

export interface ModelFace {
  id: string;
  gender: GenderSlug;
  label: string;
  thumbnailKey: string;
  r2Key: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  backgroundCount?: number;
}

export interface ModelBackground {
  id: string;
  faceId: string;
  faceLabel?: string;
  label: string;
  thumbnailKey: string;
  r2Key: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  poseCount?: number;
}

export interface ModelPose {
  id: string;
  backgroundId: string;
  backgroundLabel?: string;
  label: string;
  thumbnailKey: string;
  r2Key: string;
  showsLower: boolean;
  showsShoes: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogItem {
  id: string;
  label: string;
  type: 'lower' | 'shoe';
  thumbnailKey: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  plan: string;
  creditsRemaining: number;
  creditLimit: number;
  totalJobs: number;
  joinedAt: string;
  lastActive: string;
  emailVerified: boolean;
  status: 'active' | 'suspended' | 'inactive';
  recentJobs?: { id: string; status: string; createdAt: string; duration: string }[];
}

export type JobStatus =
  | 'QUEUED'
  | 'PREPROCESSING'
  | 'GENERATING'
  | 'UPLOADING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface Job {
  id: string;
  userEmail: string;
  status: JobStatus;
  priority: boolean;
  creditsCharged: number;
  workerId: string | null;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  errorCode?: string;
  faceLabel?: string;
  backgroundLabel?: string;
  poseLabel?: string;
  hasLower: boolean;
  hasShoe: boolean;
  outputUrl?: string;
  userHint?: string;
}

export type WorkerStatus = 'IDLE' | 'BUSY' | 'DRAINING' | 'OFFLINE';

export interface Worker {
  id: string;
  status: WorkerStatus;
  lastSeen: string;
  completed: number;
  currentJob: string | null;
  uptime: string;
}

export interface LedgerEntry {
  ts: string;
  delta: number;
  reason: string;
  admin: string;
}

export interface Stats {
  jobsToday: number;
  jobsTodayDelta: number;
  creditsToday: number;
  creditsTodayDelta: number;
  activeUsersToday: number;
  activeUsersDelta: number;
  workersHealthy: number;
  workersTotal: number;
  queueDepth: number;
  failed24h: number;
  failed24hDelta: number;
  jobsPerDay: number[];
  jobsPerDayLabels: string[];
}

export interface SystemConfig {
  credit: {
    costPerJob: number;
    maxJobsPerDay: number;
    maxConcurrentPerUser: number;
    defaultCreditsNewUser: number;
  };
  job: {
    maxRetries: number;
    timeoutMinutes: number;
    xpendingClaimMs: number;
  };
}

export type AdminRole = 'SUPER_ADMIN' | 'MODERATOR' | 'SUPPORT';

export interface ToastItem {
  id: number;
  kind?: 'error' | 'success';
  title: string;
  body?: string;
}
