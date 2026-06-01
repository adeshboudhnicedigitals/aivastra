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
  templateCount?: number;
}

// Global — no faceId
export interface ModelBackground {
  id: string;
  label: string;
  thumbnailKey: string;
  r2Key: string;
  isActive: boolean;
  sortOrder: number;
  genderSlug: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GarmentType {
  id: string;
  genderSlug: GenderSlug;
  slug: string;
  label: string;
  thumbnailKey?: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  poseCount?: number;
  templateCount?: number;
}

export interface WorkflowOption {
  id: string; // UUID from workflow_templates table
  slug: string;
  label: string;
  isActive: boolean;
  poseCount: number;
  defaultFacePhasePrompt: string;
  defaultGarmentPhasePrompt: string;
  lowerNodeId: string | null;
  shoeNodeId: string | null;
  sizeNodeIds: string[];
  createdAt: string;
}

// Poses are per (garment type × face × background) combo
// isTemplate: exactly one pose per face×background cell is the thumbnail shown to users
export interface ModelPose {
  id: string;
  garmentTypeId: string;
  faceId: string;
  backgroundId: string;
  label: string;
  thumbnailKey: string;
  r2Key: string;
  faceSideR2Key: string | null;
  workflowTemplateId: string; // UUID FK to workflow_templates
  promptFacePhase: string | null;
  promptGarmentPhase: string | null;
  showsLower: boolean;
  showsShoes: boolean;
  isTemplate: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogItem {
  id: string;
  type: 'lower' | 'shoe';
  genderSlug: string | null;
  label: string;
  thumbnailKey: string;
  isActive: boolean;
  sortOrder: number;
  subcategoryIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  tier: string;
  isBanned: boolean;
  banReason: string | null;
  balance: number;
  totalJobs: number;
  lastJobAt: string | null;
  createdAt: string;
  updatedAt: string;
  recentJobs?: {
    id: string;
    status: string;
    createdAt: string;
    startedAt?: string | null;
    completedAt?: string | null;
    creditsCharged: number;
  }[];
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
  userId?: string;
  userEmail?: string | null;
  status: JobStatus;
  priority: boolean;
  creditsCharged: number;
  workerId: string | null;
  attempts?: number;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  errorCode?: string | null;
  faceLabel?: string | null;
  backgroundLabel?: string | null;
  poseLabel?: string | null;
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
