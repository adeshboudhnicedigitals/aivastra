export type GenderSlug = 'men' | 'women' | 'boys' | 'girls';

export interface ModelFace {
  id: string;
  gender: GenderSlug;
  label: string;
  thumbnailKey: string;
  r2Key: string;
  faceSideR2Key: string | null;
  isActive: boolean;
  sortOrder: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModelBackground {
  id: string;
  label: string;
  thumbnailKey: string;
  r2Key: string;
  bgComfyR2Key: string | null;
  categoryId: number | null;
  tags: string[];
  specialTag: CategoryTag | null;
  isActive: boolean;
  isWhiteBg: boolean;
  sortOrder: number;
  genderSlug: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GarmentType {
  id: string;
  genderSlug: GenderSlug;
  slug: string;
  label: string;
  thumbnailKey?: string | null;
  instructionImageKey?: string | null;
  instructionImageUrl?: string | null;
  isActive: boolean;
  sortOrder: number;
  requiresLowerUpload: boolean;
  defaultLowerCatalogId?: string | null;
  defaultShoeCatalogId?: string | null;
  tryonCategoryId?: string | null;
  defaultPoseId: string | null;
  createdAt: string;
  updatedAt: string;
  poseCount?: number;
}

export interface WorkflowOption {
  id: string; // UUID from workflow_templates table
  slug: string;
  label: string;
  workflowType: 'regular' | 'widget' | 'tryon';
  isActive: boolean;
  poseCount: number;
  defaultFacePhasePrompt: string;
  defaultGarmentPhasePrompt: string;
  lowerNodeId: string | null;
  shoeNodeId: string | null;
  sizeNodeIds: string[];
  widgetGarmentNodeId: string | null;
  widgetCustomerPhotoNodeId: string | null;
  widgetOutputNodeId: string | null;
  tryonPersonNodeId: string | null;
  tryonGarmentNodeId: string | null;
  tryonOutputNodeId: string | null;
  createdAt: string;
}

// Poses are per (garment type × face × background) combo
export interface ModelPose {
  id: string;
  garmentTypeId: string;
  faceId: string;
  backgroundId: string;
  label: string;
  thumbnailKey: string;
  r2Key: string;
  faceSideR2Key: string | null;
  bgComfyR2Key: string | null;
  workflowTemplateId: string; // UUID FK to workflow_templates
  promptFacePhase: string | null;
  promptGarmentPhase: string | null;
  showsLower: boolean;
  showsShoes: boolean;
  workflowLabel: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type CategoryTag = 'featured' | 'trending' | 'popular';

export interface CatalogCategory {
  id: number;
  typeId: number;
  typeSlug: string;
  parentId: number | null;
  slug: string;
  label: string;
  genderSlug: string | null;
  thumbnailKey: string | null;
  thumbnailUrl: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface CatalogItem {
  id: string;
  categoryId: number | null;
  type: 'lower' | 'shoe';
  genderSlug: string | null;
  label: string;
  thumbnailKey: string;
  r2Key: string;
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
  phone: string | null;
  tier: string;
  maxActiveDevices: number;
  isBanned: boolean;
  banReason: string | null;
  isAdmin: boolean;
  adminRole: string | null;
  hasPassword: boolean;
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
  faceThumbnailUrl?: string | null;
  backgroundLabel?: string | null;
  poseLabel?: string | null;
  hasLower: boolean;
  hasShoe: boolean;
  jobType?: 'catalogue' | 'tryon' | 'widget';
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

export interface CreditPlan {
  id: string;
  slug: string;
  name: string;
  subtext: string;
  credits: number;
  basePaise: number;
  isActive: boolean;
  isHighlighted: boolean;
  badge: string | null;
  sortOrder: number;
  queueStream: 'priority' | 'normal' | 'low';
  watermark: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModelPoseAsset {
  id: string;
  label: string;
  displayName: string | null;
  r2Key: string;
  thumbnailKey: string;
  genderSlug: string | null;
  workflowTemplateId: string | null;
  promptGarmentPhase: string | null;
  promptFacePhase: string | null;
  poseVariant: string | null;
  isActive: boolean;
  sortOrder: number;
  deletedAt: string | null;
  createdAt: string;
}

export interface PoseGarmentConfig {
  id: string;
  isActive: boolean;
  defaultWorkflowTemplateId: string | null;
  defaultPromptGarmentPhase: string | null;
  defaultPromptFacePhase: string | null;
  displayName: string | null;
  label: string;
  thumbnailKey: string;
  thumbnailUrl: string;
  config: {
    workflowTemplateId: string | null;
    promptGarmentPhase: string | null;
    promptFacePhase: string | null;
  } | null;
}

export type AdminRole = 'SUPER_ADMIN' | 'MODERATOR' | 'SUPPORT';

export interface ToastItem {
  id: number;
  kind?: 'error' | 'success';
  title: string;
  body?: string;
}

export interface ContactRequest {
  id: string;
  userId: string | null;
  name: string;
  email: string;
  phone: string;
  source: string | null;
  message: string | null;
  attachmentKey: string | null;
  status: 'new' | 'read' | 'done';
  createdAt: string;
}

export interface TryonSample {
  id: string;
  categoryId: string;
  r2Key: string;
  thumbnailKey: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface TryonCategory {
  id: string;
  name: string;
  slug: string;
  workflowTemplateId: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  samples: TryonSample[];
}
