export type GenderSlug = 'men' | 'women' | 'boys' | 'girls';

export type AdminRole = 'SUPER_ADMIN' | 'MODERATOR' | 'SUPPORT' | 'ADMIN';

export type CategoryTag = 'featured' | 'trending' | 'popular';

export interface ModelFace {
  id: string;
  gender: GenderSlug;
  label: string;
  thumbnailKey: string;
  r2Key: string;
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
  categoryId: number | null;
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
  isActive: boolean;
  sortOrder: number;
  requiresLowerUpload: boolean;
  createdAt: string;
  updatedAt: string;
  poseCount?: number;
}

export interface WorkflowOption {
  id: string;
  slug: string;
  label: string;
  isActive: boolean;
  workflowType?: 'regular' | 'widget' | 'saree' | 'tryon';
  poseCount: number;
  defaultFacePhasePrompt: string;
  defaultGarmentPhasePrompt: string;
  lowerNodeId: string | null;
  shoeNodeId: string | null;
  sizeNodeIds: string[];
  createdAt: string;
}

export interface WorkflowDetail extends WorkflowOption {
  jsonContent: Record<string, unknown>;
  faceNodeId: string;
  poseNodeId: string;
  bgNodeId: string;
  upperNodeIds: string[];
  facePhasePromptNode: string;
  garmentPhasePromptNode: string;
  latentSizeNodeIds?: string[];
  latentMaxPx?: number;
  outputSizeNodeIds?: string[];
  outputMaxPx?: number;
  resultNodeId?: string | null;
  widgetGarmentNodeId?: string | null;
  widgetCustomerPhotoNodeId?: string | null;
  widgetOutputNodeId?: string | null;
  updatedAt: string;
}

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
  workflowTemplateId: string;
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

export interface BackgroundCategory {
  id: number;
  slug: string;
  label: string;
  thumbnailKey: string | null;
  thumbnailUrl?: string | null;
  genderSlug: string | null;
  typeSlug?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  itemCount?: number;
}

export interface BackgroundCategoryWithCount extends BackgroundCategory {
  itemCount: number;
}

export interface CatalogCategory {
  id: number;
  typeId: number;
  typeSlug: string;
  parentId: number | null;
  slug: string;
  label: string;
  genderSlug: string | null;
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
  tier: string;
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
  backgroundLabel?: string | null;
  poseLabel?: string | null;
  workflowLabel?: string | null;
  faceThumbnailUrl?: string | null;
  hasLower: boolean;
  hasShoe: boolean;
  outputUrl?: string;
  userHint?: string | null;
}

export interface JobEvent {
  id: string;
  jobId: string;
  eventType: string;
  payload?: Record<string, unknown> | null;
  createdAt: string;
}

export interface JobDetail extends Job {
  inputImages: {
    face?: string;
    background?: string;
    pose?: string;
    upper?: string;
    lower?: string;
    shoe?: string;
  };
  events: JobEvent[];
}

export interface AdminJobEvent {
  jobId: string;
  userId: string;
  type: 'STATUS';
  status: JobStatus;
  workerId?: string;
  errorCode?: string;
  resultKey?: string;
  thumbnailKey?: string;
}

export interface PaginatedResponse<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
}

export interface DashboardWorker {
  id: string;
  status: string;
  healthy: boolean;
  lastSeen?: string;
}

export type WorkerStatus = 'IDLE' | 'BUSY' | 'DRAINING' | 'OFFLINE';

export interface Worker {
  id: string;
  status: WorkerStatus;
  healthy: boolean;
  lastSeen?: string;
  completed: number;
  currentJob?: string | null;
  uptime: number;
}

export interface AdminWorkerRegistryEntry {
  id: string;
  url: string;
  status: 'IDLE' | 'BUSY' | 'DRAINING' | string;
  healthy: boolean;
  lastSeen: number | string | null;
}

export type AdminWorkersResponse = AdminWorkerRegistryEntry[];

export interface Stats {
  jobsToday: number;
  jobsTodayDelta: number | null;
  creditsToday: number;
  creditsTodayDelta: number | null;
  activeUsersToday: number;
  activeUsersDelta: number | null;
  workersHealthy: number;
  workersTotal: number;
  workers: DashboardWorker[];
  queueDepth: number;
  failed24h: number;
  recentFailures: { id: string; user: string; error: string; age: string }[];
  stuckJobs: { id: string; user: string; age: string }[];
  jobsPerDay: number[];
  jobsPerDayLabels: string[];
  sevenDayTotal: number;
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
  createdAt: string;
  updatedAt: string;
}

export interface ResolutionConfig {
  enabled: boolean;
  creditCost: number;
}

export interface SystemConfig {
  creditCostPerJob: number;
  maxJobsPerDay: number;
  freeTrialCredits: number;
  resolutions: Record<'HD' | '2K' | '4K', ResolutionConfig>;
}

export interface ModelPoseAsset {
  id: string;
  label: string;
  displayName: string | null;
  r2Key: string;
  faceSideR2Key: string | null;
  bgComfyR2Key: string | null;
  thumbnailKey: string;
  genderSlug: string | null;
  faceId: string | null;
  backgroundId: string | null;
  workflowTemplateId: string | null;
  promptGarmentPhase: string | null;
  poseVariant: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface PoseGarmentConfig {
  id: string;
  isActive: boolean;
  defaultWorkflowTemplateId: string | null;
  defaultPromptGarmentPhase: string | null;
  displayName: string | null;
  label: string;
  thumbnailKey: string;
  thumbnailUrl: string;
  config: {
    workflowTemplateId: string | null;
    promptGarmentPhase: string | null;
  } | null;
}

export interface WidgetClient {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  websiteUrl: string;
  companySize: string;
  purpose: string;
  businessAddress: string;
  widgetKey: string;
  isActive: boolean;
  allowedOrigins: string[];
  creditBalance: number;
  createdAt: string;
  updatedAt: string;
}

export interface WidgetClientDetail extends WidgetClient {
  ledger: { id: string; delta: number; reason: string; createdAt: string }[];
  recentJobs: {
    id: string;
    status: string;
    creditsCharged: number;
    createdAt: string;
    completedAt: string | null;
  }[];
}

export interface WidgetClientsResponse {
  clients: WidgetClient[];
  total: number;
  page: number;
  limit: number;
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

export interface TryonSettings {
  personSampleUrl: string | null;
  garmentSampleUrl: string | null;
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

export interface ContactSourcesSummary {
  sources: Array<string | null>;
  newBySource: Record<string, number>;
  totalBySource: Record<string, number>;
}

export interface SareeWorkflow {
  id: string;
  slug: string;
  label: string;
  isActive: boolean;
  jsonContent: Record<string, unknown>;
  detected: {
    modelImageNode: string | null;
    sareeImageNode: string | null;
    outputNode: string | null;
    positivePromptNode: string | null;
    negativePromptNode: string | null;
    defaultPositivePrompt: string;
    defaultNegativePrompt: string;
  };
}

export interface SareeSettings {
  modelImageKey: string | null;
  modelImageThumbKey: string | null;
  modelImageUrl: string | null;
  modelImageThumbUrl: string | null;
  sampleSareeImageKey: string | null;
  sampleSareeImageThumbKey: string | null;
  sampleSareeImageUrl: string | null;
  sampleSareeImageThumbUrl: string | null;
  isConfigured: boolean;
}

export interface SareeWorker {
  id: string;
  label: string;
  url: string;
  isActive: boolean;
  allowedJobTypes: string[];
  status: string | null;
}
