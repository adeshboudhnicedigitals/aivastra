import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icons';
import { SearchableSelect } from '../components/SearchableSelect';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlState } from '../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../lib/data';

interface AuditLogItem {
  id: string;
  actorUserId: string;
  actorRole: string;
  actorEmail: string | null;
  actorDisplayName: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  resourceLabel: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

interface AuditLogsResponse {
  page: number;
  pageSize: number;
  total: number;
  items: AuditLogItem[];
}

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

type ActionCategory = 'created' | 'updated' | 'changed' | 'deleted' | 'default';

function getActionCategory(action: string): ActionCategory {
  if (/(\.|_)(delete|delete_\w+|revoke|erase|ban|deduct)$/.test(action)) return 'deleted';
  if (/(\.|_)(create|grant|import)$/.test(action)) return 'created';
  if (/(\.|_)(approve|release|restore)$/.test(action)) return 'changed';
  if (/(\.|_)(update|update_\w+|reassign|rename)$/.test(action)) return 'updated';
  return 'default';
}

const ACTION_CATEGORY_DOT: Record<ActionCategory, string> = {
  created: 'var(--success-ink, #22c55e)',
  updated: 'var(--accent, #6366f1)',
  changed: 'var(--warn-ink, #f59e0b)',
  deleted: 'var(--danger-ink, #ef4444)',
  default: 'var(--muted)',
};

type DiffStatus = 'added' | 'removed' | 'changed';

interface ParsedDiffItem {
  key: string;
  label: string;
  status: DiffStatus;
  isIdArray?: boolean;
  idCount?: number;
  ids?: string[];
  beforeVal?: string;
  afterVal?: string;
  summaryText: string;
}

const FIELD_LABELS: Record<string, string> = {
  id: 'ID',
  ids: 'IDs',
  role: 'Role',
  status: 'Status',
  label: 'Name',
  slug: 'Slug',
  url: 'URL',
  isActive: 'Active',
  allowedJobTypes: 'Allowed Job Types',
  workflowType: 'Workflow Type',
  amount: 'Amount',
  reason: 'Reason',
  tier: 'Tier',
  username: 'Username',
  email: 'Email',
  displayName: 'Display Name',
  banReason: 'Ban Reason',
  deleted: 'Deleted Items',
};

function humanizeFieldKey(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const spaced = key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function humanizeFieldValue(jsonStr: string | undefined): string {
  if (jsonStr === undefined) return '(none)';
  try {
    const value = JSON.parse(jsonStr);
    if (value === null) return '(none)';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) {
      if (!value.length) return '(none)';
      if (value.length <= 4) return value.join(', ');
      return `${value.length} items`;
    }
    if (typeof value === 'object') return JSON.stringify(value);
    const str = String(value);
    return /^[a-z]+$/.test(str) ? str.charAt(0).toUpperCase() + str.slice(1) : str;
  } catch {
    return jsonStr;
  }
}

const NOISY_FIELDS = new Set([
  'created_at',
  'updated_at',
  'createdAt',
  'updatedAt',
  'deleted_at',
  'deletedAt',
]);

function formatRelativeTime(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths}mo ago`;
  } catch {
    return '';
  }
}

function formatUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown client';
  let browser = 'Browser';
  if (/chrome|crios/i.test(ua) && !/edg/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
  else if (/edg/i.test(ua)) browser = 'Edge';

  let os = 'OS';
  if (/mac/i.test(ua)) os = 'macOS';
  else if (/win/i.test(ua)) os = 'Windows';
  else if (/linux/i.test(ua)) os = 'Linux';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad/i.test(ua)) os = 'iOS';

  return `${browser} · ${os}`;
}

function parseDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): ParsedDiffItem[] {
  const b = before ?? {};
  const a = after ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const results: ParsedDiffItem[] = [];

  for (const key of keys) {
    if (NOISY_FIELDS.has(key)) continue;

    const hasBefore = key in b;
    const hasAfter = key in a;
    const rawBefore = b[key];
    const rawAfter = a[key];

    // Detect if this is an array of IDs or records
    const isArrayField =
      Array.isArray(rawBefore) || Array.isArray(rawAfter) || key === 'ids' || key === 'deleted';

    if (key === 'id' && !isArrayField) continue;

    if (isArrayField) {
      const arr = Array.isArray(rawBefore)
        ? (rawBefore as string[])
        : Array.isArray(rawAfter)
          ? (rawAfter as string[])
          : [];
      if (arr.length > 0) {
        const status: DiffStatus = !hasBefore ? 'added' : !hasAfter ? 'removed' : 'changed';
        const noun = arr.length === 1 ? 'resource' : 'resources';
        const summary =
          status === 'removed'
            ? `${arr.length} ${noun} removed`
            : status === 'added'
              ? `${arr.length} ${noun} created`
              : `${arr.length} ${noun} updated`;
        results.push({
          key,
          label: humanizeFieldKey(key),
          status,
          isIdArray: true,
          idCount: arr.length,
          ids: arr.map(String),
          summaryText: summary,
        });
        continue;
      }
    }

    const beforeStr = hasBefore ? JSON.stringify(rawBefore) : undefined;
    const afterStr = hasAfter ? JSON.stringify(rawAfter) : undefined;
    if (beforeStr === afterStr) continue;

    const status: DiffStatus = !hasBefore ? 'added' : !hasAfter ? 'removed' : 'changed';
    const beforeVal = humanizeFieldValue(beforeStr);
    const afterVal = humanizeFieldValue(afterStr);
    const field = humanizeFieldKey(key);

    let summaryText = '';
    if (status === 'added') summaryText = `Set ${field} to ${afterVal}`;
    else if (status === 'removed') summaryText = `Removed ${field} (was ${beforeVal})`;
    else summaryText = `Changed ${field} from ${beforeVal} to ${afterVal}`;

    results.push({
      key,
      label: field,
      status,
      beforeVal,
      afterVal,
      summaryText,
    });
  }

  return results.sort((x, y) => x.label.localeCompare(y.label));
}

function humanizeActionFallback(action: string): string {
  const verb = action.split('.').pop() ?? action;
  const words = verb.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function snapshotLabel(snapshot: Record<string, unknown> | null): string | undefined {
  const label = snapshot?.label ?? snapshot?.title ?? snapshot?.name ?? snapshot?.companyName;
  return typeof label === 'string' && label.length > 0 ? label : undefined;
}

function describeAction(log: AuditLogItem): string {
  const who =
    snapshotLabel(log.after) ??
    snapshotLabel(log.before) ??
    log.resourceLabel ??
    log.resourceType.replace(/_/g, ' ');
  const after = log.after ?? {};
  const amount = typeof after.amount === 'number' ? after.amount : undefined;
  const role = typeof after.role === 'string' ? after.role : undefined;

  switch (log.action) {
    case 'credits.grant':
      return amount !== undefined ? `Added ${amount} credits to ${who}` : `Added credits to ${who}`;
    case 'credits.deduct':
      return amount !== undefined
        ? `Removed ${amount} credits from ${who}`
        : `Removed credits from ${who}`;
    case 'users.ban':
      return `Banned user ${who}`;
    case 'users.update':
      return `Updated account details for ${who}`;
    case 'users.create':
      return `Created a new user account for ${who}`;
    case 'users.delete':
      return `Deleted user account ${who} (data erasure)`;
    case 'admin_users.approve':
      return `Approved admin access for ${who}`;
    case 'admin_users.reject':
      return `Rejected the admin access request from ${who}`;
    case 'admin_users.update_role':
      return role ? `Changed ${who}'s admin role to ${role}` : `Changed admin role for ${who}`;
    case 'admin_users.revoke':
      return `Removed admin access from ${who}`;
    case 'worker.create':
      return `Added GPU worker "${who}"`;
    case 'worker.update':
      return `Updated GPU worker "${who}"`;
    case 'worker.delete':
      return `Removed GPU worker "${who}"`;
    case 'workflow.create':
      return `Created workflow "${who}"`;
    case 'workflow.update':
      return `Updated workflow "${who}"`;
    case 'workflow.reassign':
      return `Reassigned workflow "${who}"`;
    case 'workflow.delete':
      return `Deleted workflow "${who}"`;
    case 'face.create':
      return `Added face "${who}"`;
    case 'face.update':
      return `Updated face "${who}"`;
    case 'face.delete':
      return `Deleted face "${who}"`;
    case 'background.create':
      return `Added background "${who}"`;
    case 'background.update':
      return `Updated background "${who}"`;
    case 'background.delete':
      return `Deleted background "${who}"`;
    case 'background.bulk_update':
      return 'Bulk-updated backgrounds';
    case 'pose.create':
      return `Added pose "${who}"`;
    case 'pose.update':
      return `Updated pose "${who}"`;
    case 'pose.delete':
      return `Deleted pose "${who}"`;
    case 'pose.bulk_workflow_update':
      return 'Bulk-assigned a workflow to poses';
    case 'pose.bulk_rename':
      return 'Bulk-renamed poses';
    case 'sample_video.create':
      return `Added sample video "${who}"`;
    case 'sample_video.update':
      return `Updated sample video "${who}"`;
    case 'sample_video.delete':
      return `Deleted sample video "${who}"`;
    case 'saree_style.create':
      return `Added saree style "${who}"`;
    case 'saree_style.update':
      return `Updated saree style "${who}"`;
    case 'garment_type.create':
      return `Added garment type "${who}"`;
    case 'garment_type.update':
      return `Updated garment type "${who}"`;
    case 'garment_type.delete':
      return `Deleted garment type "${who}"`;
    case 'catalog_item.create':
      return `Added catalog item "${who}"`;
    case 'catalog_item.update':
      return `Updated catalog item "${who}"`;
    case 'catalog_item.delete':
      return `Deleted catalog item "${who}"`;
    case 'catalog_item.bulk_update':
      return 'Bulk-updated catalog items';
    case 'catalog_category.create':
      return `Added catalog category "${who}"`;
    case 'catalog_category.update':
      return `Updated catalog category "${who}"`;
    case 'catalog_category.delete':
      return `Deleted catalog category "${who}"`;
    case 'catalogue_template.create':
      return `Added catalogue template "${who}"`;
    case 'catalogue_template.update':
      return `Updated catalogue template "${who}"`;
    case 'catalogue_template.delete':
      return `Deleted catalogue template "${who}"`;
    case 'catalogue_template.update_looks':
      return `Updated the looks for catalogue template "${who}"`;
    case 'jobs.delete_assets': {
      const deleted = Array.isArray(after.deleted) ? (after.deleted as string[]) : [];
      const jobRef = log.resourceId ? `#${log.resourceId.slice(0, 8)}` : 'a job';
      return deleted.length > 0
        ? `Deleted job assets (${deleted.join(', ')}) for job ${jobRef}`
        : `Deleted job assets for job ${jobRef}`;
    }
    case 'asset.restore':
      return 'Restored an asset from the recycle bin';
    case 'asset.permanent_delete':
      return 'Permanently deleted an asset';
    case 'asset.bulk_import':
      return 'Bulk-imported assets from a ZIP';
    case 'config.update':
      return 'Updated system configuration';
    case 'config.app_video_update':
      return 'Updated the app intro video';
    case 'credit_plan.create':
      return `Added credit plan "${who}"`;
    case 'credit_plan.update':
      return `Updated credit plan "${who}"`;
    case 'credit_plan.delete':
      return `Deleted credit plan "${who}"`;
    case 'merchant.create':
      return `Added merchant "${who}"`;
    case 'merchant.update':
      return `Updated merchant "${who}"`;
    case 'merchant.credit_grant':
      return amount !== undefined
        ? `Granted ${amount} credits to merchant "${who}"`
        : `Granted credits to merchant "${who}"`;
    case 'saree_workflow.create':
      return `Added saree workflow "${who}"`;
    case 'saree_workflow.delete':
      return `Deleted saree workflow "${who}"`;
    case 'saree_settings.update':
      return 'Updated saree settings';
    case 'held_jobs.release': {
      const released = typeof after.released === 'number' ? after.released : undefined;
      return released !== undefined
        ? `Released ${released} held bulk-flat job(s)`
        : 'Released held bulk-flat jobs';
    }
    default:
      return `${humanizeActionFallback(log.action)} — ${who}`;
  }
}

const ACTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'credits.grant', label: 'Credits added' },
  { value: 'credits.deduct', label: 'Credits removed' },
  { value: 'users.ban', label: 'User banned' },
  { value: 'users.update', label: 'User details updated' },
  { value: 'users.create', label: 'User account created' },
  { value: 'users.delete', label: 'User account deleted' },
  { value: 'admin_users.approve', label: 'Admin access approved' },
  { value: 'admin_users.reject', label: 'Admin access request rejected' },
  { value: 'admin_users.update_role', label: 'Admin role changed' },
  { value: 'admin_users.revoke', label: 'Admin access removed' },
  { value: 'worker.create', label: 'Worker added' },
  { value: 'worker.update', label: 'Worker updated' },
  { value: 'worker.delete', label: 'Worker removed' },
  { value: 'workflow.create', label: 'Workflow created' },
  { value: 'workflow.update', label: 'Workflow updated' },
  { value: 'workflow.reassign', label: 'Workflow reassigned' },
  { value: 'workflow.delete', label: 'Workflow deleted' },
  { value: 'face.create', label: 'Face added' },
  { value: 'face.update', label: 'Face updated' },
  { value: 'face.delete', label: 'Face deleted' },
  { value: 'background.create', label: 'Background added' },
  { value: 'background.update', label: 'Background updated' },
  { value: 'background.delete', label: 'Background deleted' },
  { value: 'pose.create', label: 'Pose added' },
  { value: 'pose.update', label: 'Pose updated' },
  { value: 'pose.delete', label: 'Pose deleted' },
  { value: 'sample_video.create', label: 'Sample video added' },
  { value: 'sample_video.update', label: 'Sample video updated' },
  { value: 'sample_video.delete', label: 'Sample video deleted' },
  { value: 'saree_style.create', label: 'Saree style added' },
  { value: 'saree_style.update', label: 'Saree style updated' },
  { value: 'garment_type.create', label: 'Garment type added' },
  { value: 'garment_type.update', label: 'Garment type updated' },
  { value: 'garment_type.delete', label: 'Garment type deleted' },
  { value: 'catalog_item.create', label: 'Catalog item added' },
  { value: 'catalog_item.update', label: 'Catalog item updated' },
  { value: 'catalog_item.delete', label: 'Catalog item deleted' },
  { value: 'catalog_category.create', label: 'Catalog category added' },
  { value: 'catalog_category.update', label: 'Catalog category updated' },
  { value: 'catalog_category.delete', label: 'Catalog category deleted' },
  { value: 'catalogue_template.create', label: 'Catalogue template added' },
  { value: 'catalogue_template.update', label: 'Catalogue template updated' },
  { value: 'catalogue_template.delete', label: 'Catalogue template deleted' },
  { value: 'jobs.delete_assets', label: 'Job assets deleted' },
  { value: 'asset.restore', label: 'Asset restored' },
  { value: 'asset.permanent_delete', label: 'Asset permanently deleted' },
  { value: 'asset.bulk_import', label: 'Assets bulk-imported' },
  { value: 'config.update', label: 'System config updated' },
  { value: 'config.app_video_update', label: 'App intro video updated' },
  { value: 'credit_plan.create', label: 'Credit plan added' },
  { value: 'credit_plan.update', label: 'Credit plan updated' },
  { value: 'credit_plan.delete', label: 'Credit plan deleted' },
  { value: 'merchant.create', label: 'Merchant added' },
  { value: 'merchant.update', label: 'Merchant updated' },
  { value: 'merchant.credit_grant', label: 'Merchant credits granted' },
  { value: 'saree_workflow.create', label: 'Saree workflow added' },
  { value: 'saree_workflow.delete', label: 'Saree workflow deleted' },
  { value: 'saree_settings.update', label: 'Saree settings updated' },
  { value: 'held_jobs.release', label: 'Held jobs released' },
];

const RESOURCE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'job', label: 'Jobs' },
  { value: 'worker', label: 'Workers' },
  { value: 'workflow', label: 'Workflows' },
  { value: 'user', label: 'Users' },
  { value: 'admin_user', label: 'Team members' },
  { value: 'user_credits', label: 'Credits' },
  { value: 'face', label: 'Faces' },
  { value: 'background', label: 'Backgrounds' },
  { value: 'pose', label: 'Poses' },
  { value: 'sample_video', label: 'Sample videos' },
  { value: 'saree_style', label: 'Saree styles' },
  { value: 'garment_type', label: 'Garment types' },
  { value: 'catalog_item', label: 'Lower garments & shoes' },
  { value: 'catalog_category', label: 'Catalog categories' },
  { value: 'catalogue_template', label: 'Catalogue templates' },
  { value: 'asset', label: 'Assets (general)' },
  { value: 'system_config', label: 'System config' },
  { value: 'credit_plan', label: 'Credit plans' },
  { value: 'merchant', label: 'Merchants' },
  { value: 'saree_workflow', label: 'Saree workflows' },
  { value: 'saree_settings', label: 'Saree settings' },
];

function getRelativeDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

export default function AuditLogsPage({ toast }: Props) {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [loading, setLoading] = useState(true);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [resourceTypeFilter, setResourceTypeFilter] = useState('');
  const [resourceIdFilter, setResourceIdFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [actorFilterLabel, setActorFilterLabel] = useState('');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [datePreset, setDatePreset] = useState<'all' | 'today' | '7d' | '30d' | 'custom'>('all');

  // Popovers & Drawer
  const [dateOpen, setDateOpen] = useState(false);
  const [idLookupOpen, setIdLookupOpen] = useState(false);
  const [expandedLogId, setExpandedLogId] = useUrlState('expanded');
  const closeExpanded = useCloseOverlay(['expanded']);
  const [expandedIdKey, setExpandedIdKey] = useState<string | null>(null);

  const dateMenuRef = useRef<HTMLDivElement>(null);
  const idMenuRef = useRef<HTMLDivElement>(null);

  // Close popovers on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (dateOpen && dateMenuRef.current && !dateMenuRef.current.contains(target)) {
        setDateOpen(false);
      }
      if (idLookupOpen && idMenuRef.current && !idMenuRef.current.contains(target)) {
        setIdLookupOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dateOpen, idLookupOpen]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (actionFilter.trim()) params.set('action', actionFilter.trim());
      if (resourceTypeFilter.trim()) params.set('resourceType', resourceTypeFilter.trim());
      if (resourceIdFilter.trim()) params.set('resourceId', resourceIdFilter.trim());
      if (actorFilter.trim()) params.set('actorUserId', actorFilter.trim());
      if (startDateFilter) params.set('startDate', startDateFilter);
      if (endDateFilter) params.set('endDate', endDateFilter);

      const data = await apiFetch<AuditLogsResponse>(`/admin/audit-logs?${params.toString()}`);
      setLogs(data.items);
      setTotal(data.total);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load audit logs',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [
    page,
    pageSize,
    actionFilter,
    resourceTypeFilter,
    resourceIdFilter,
    actorFilter,
    startDateFilter,
    endDateFilter,
    toast,
  ]);

  const filterByActor = (userId: string, label: string) => {
    setActorFilter(userId);
    setActorFilterLabel(label);
    setPage(1);
  };

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.ceil(total / pageSize) || 1;
  const startItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(total, page * pageSize);

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const hasActiveFilters = Boolean(
    actionFilter ||
      resourceTypeFilter ||
      resourceIdFilter ||
      actorFilter ||
      startDateFilter ||
      endDateFilter,
  );

  const clearAllFilters = () => {
    setActionFilter('');
    setResourceTypeFilter('');
    setResourceIdFilter('');
    setActorFilter('');
    setActorFilterLabel('');
    setStartDateFilter('');
    setEndDateFilter('');
    setDatePreset('all');
    setPage(1);
  };

  function applyDatePreset(preset: 'all' | 'today' | '7d' | '30d') {
    setDatePreset(preset);
    if (preset === 'all') {
      setStartDateFilter('');
      setEndDateFilter('');
    } else if (preset === 'today') {
      const today = getRelativeDate(0);
      setStartDateFilter(today);
      setEndDateFilter(today);
    } else if (preset === '7d') {
      setStartDateFilter(getRelativeDate(7));
      setEndDateFilter(getRelativeDate(0));
    } else if (preset === '30d') {
      setStartDateFilter(getRelativeDate(30));
      setEndDateFilter(getRelativeDate(0));
    }
    setPage(1);
    setDateOpen(false);
  }

  const getDateLabel = () => {
    if (datePreset === 'today') return 'Today';
    if (datePreset === '7d') return 'Last 7 days';
    if (datePreset === '30d') return 'Last 30 days';
    if (startDateFilter || endDateFilter) {
      return `${startDateFilter || 'Any'} → ${endDateFilter || 'Today'}`;
    }
    return 'All time';
  };

  const renderCellValue = (val: string | undefined, isStrikeThrough = false, color?: string) => {
    if (!val) return null;
    const isUrl = /^https?:\/\//i.test(val);
    if (isUrl) {
      let displayUrl = val;
      try {
        const parsed = new URL(val);
        const path = parsed.pathname === '/' ? '' : parsed.pathname;
        displayUrl = `${parsed.host}${path.length > 18 ? `${path.slice(0, 16)}…` : path}`;
      } catch {
        if (val.length > 30) displayUrl = `${val.slice(0, 28)}…`;
      }
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: 'var(--mono)',
            fontSize: 11.5,
            textDecoration: isStrikeThrough ? 'line-through' : 'none',
          }}
        >
          <a
            href={val}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: color || 'var(--primary)',
              textDecoration: 'none',
              borderBottom: '1px dotted currentColor',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
            title={val}
          >
            <span>{displayUrl}</span>
            <Icon.ExternalLink style={{ width: 10, height: 10, opacity: 0.8 }} />
          </a>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(val);
              toast({ title: 'URL copied' });
            }}
            title="Copy full URL"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--muted)',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <Icon.Copy style={{ width: 11, height: 11, opacity: 0.6 }} />
          </button>
        </span>
      );
    }

    if (val.length > 36 && !val.includes(' ')) {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: 'var(--mono)',
            fontSize: 11.5,
            textDecoration: isStrikeThrough ? 'line-through' : 'none',
            color,
          }}
        >
          <span title={val}>
            {val.slice(0, 16)}…{val.slice(-6)}
          </span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(val);
              toast({ title: 'Value copied' });
            }}
            title="Copy full value"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--muted)',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <Icon.Copy style={{ width: 11, height: 11, opacity: 0.6 }} />
          </button>
        </span>
      );
    }

    return (
      <span
        style={{
          textDecoration: isStrikeThrough ? 'line-through' : 'none',
          color,
          wordBreak: 'break-word',
        }}
      >
        {val}
      </span>
    );
  };

  const renderLogDetails = (item: AuditLogItem) => {
    const diffItems = parseDiff(item.before, item.after);
    const cat = getActionCategory(item.action);
    const hasMetadata = item.ipAddress || item.userAgent || item.requestId;
    const idDiffs = diffItems.filter((d) => d.isIdArray);
    const propertyDiffs = diffItems.filter((d) => !d.isIdArray);

    return (
      <div
        style={{
          padding: '12px 18px',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r, 8px)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {/* Top Header Bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 10,
            borderBottom: '1px solid var(--border)',
            paddingBottom: 8,
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 7px',
                borderRadius: 4,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--ink)',
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: ACTION_CATEGORY_DOT[cat],
                  display: 'inline-block',
                }}
              />
              {cat.toUpperCase()}
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
              Event Details
            </span>
          </div>
        </div>

        {/* 4-Column Event Metadata Summary */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 10,
            padding: '8px 12px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r, 6px)',
            marginBottom: 10,
            fontSize: 12,
          }}
        >
          <div>
            <span
              style={{
                color: 'var(--muted)',
                fontSize: 10,
                display: 'block',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                fontWeight: 600,
              }}
            >
              Target Entity
            </span>
            <div style={{ fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>
              {item.resourceLabel || humanizeFieldKey(item.resourceType)}
            </div>
            {item.resourceId && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(item.resourceId ?? '');
                  toast({ title: 'Record ID copied' });
                }}
                title="Click to copy Record ID"
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  color: 'var(--muted)',
                  fontFamily: 'var(--mono)',
                  fontSize: 10.5,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  marginTop: 2,
                }}
              >
                <span>{item.resourceId.slice(0, 10)}…</span>
                <Icon.Copy style={{ width: 10, height: 10, opacity: 0.6 }} />
              </button>
            )}
          </div>

          <div>
            <span
              style={{
                color: 'var(--muted)',
                fontSize: 10,
                display: 'block',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                fontWeight: 600,
              }}
            >
              Team Member
            </span>
            <div style={{ fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>
              {item.actorEmail ?? item.actorDisplayName ?? item.actorUserId}
            </div>
            <div style={{ marginTop: 2 }}>
              <span className="badge" style={{ fontSize: 9.5, padding: '1px 5px' }}>
                {item.actorRole}
              </span>
            </div>
          </div>

          <div>
            <span
              style={{
                color: 'var(--muted)',
                fontSize: 10,
                display: 'block',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                fontWeight: 600,
              }}
            >
              Timestamp
            </span>
            <div style={{ fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>
              {formatDate(item.createdAt)}
            </div>
            <span style={{ color: 'var(--muted)', fontSize: 10.5 }}>
              {formatRelativeTime(item.createdAt)}
            </span>
          </div>

          <div>
            <span
              style={{
                color: 'var(--muted)',
                fontSize: 10,
                display: 'block',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                fontWeight: 600,
              }}
            >
              Event Identifier
            </span>
            <div
              style={{
                fontWeight: 500,
                fontFamily: 'var(--mono)',
                fontSize: 11,
                color: 'var(--ink)',
                marginTop: 2,
              }}
            >
              {item.action}
            </div>
          </div>
        </div>

        {/* Consequence & Diffs Area */}
        {diffItems.length === 0 ? (
          <div
            style={{
              padding: '10px 14px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r, 6px)',
              fontSize: 12.5,
              color: 'var(--muted)',
            }}
          >
            Action completed successfully. No property modifications were logged in this event
            payload.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* 1. Bulk / Array ID Consequence Blocks */}
            {idDiffs.map((row) => {
              const isExpandedList = expandedIdKey === row.key;
              const isRemoved = row.status === 'removed';
              return (
                <div
                  key={row.key}
                  style={{
                    padding: '10px 14px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r, 6px)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>{isRemoved ? '🔴' : '🟢'}</span>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 13 }}>
                          {row.summaryText}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                          {isRemoved
                            ? 'Permanently removed from storage & database'
                            : 'Created and added to active resources'}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => {
                          void navigator.clipboard.writeText(row.ids?.join('\n') || '');
                          toast({
                            title:
                              row.idCount === 1
                                ? 'ID copied to clipboard'
                                : `${row.idCount} IDs copied to clipboard`,
                          });
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 11.5,
                        }}
                      >
                        <Icon.Copy />{' '}
                        {row.idCount === 1 ? 'Copy ID' : `Copy all ${row.idCount} IDs`}
                      </button>
                      <button
                        type="button"
                        className="btn sm secondary"
                        onClick={() => setExpandedIdKey(isExpandedList ? null : row.key)}
                        style={{ fontSize: 11.5 }}
                      >
                        {isExpandedList
                          ? row.idCount === 1
                            ? 'Hide ID ↑'
                            : 'Hide IDs ↑'
                          : row.idCount === 1
                            ? 'View ID ▾'
                            : `View all ${row.idCount} IDs ▾`}
                      </button>
                    </div>
                  </div>

                  {/* Sample Chips when collapsed */}
                  {!isExpandedList && row.ids && row.ids.length > 0 && (
                    <div
                      style={{
                        marginTop: 8,
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 5,
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>Sample:</span>
                      {row.ids.slice(0, 3).map((id) => (
                        <span
                          key={id}
                          style={{
                            fontFamily: 'var(--mono)',
                            fontSize: 10.5,
                            padding: '1px 5px',
                            background: 'var(--surface-2)',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            color: 'var(--ink)',
                          }}
                        >
                          {id.slice(0, 10)}…
                        </span>
                      ))}
                      {row.ids.length > 3 && (
                        <span
                          style={{ fontSize: 10.5, color: 'var(--muted)', fontStyle: 'italic' }}
                        >
                          +{row.ids.length - 3} more
                        </span>
                      )}
                    </div>
                  )}

                  {/* Numbered Monospace List when expanded */}
                  {isExpandedList && (
                    <div
                      style={{
                        marginTop: 8,
                        maxHeight: 160,
                        overflowY: 'auto',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '8px 12px',
                        fontFamily: 'var(--mono)',
                        fontSize: 11,
                        lineHeight: 1.5,
                        color: 'var(--ink)',
                      }}
                    >
                      {row.ids?.map((id, idx) => (
                        <div key={id} style={{ display: 'flex', gap: 10 }}>
                          <span
                            style={{
                              color: 'var(--muted)',
                              width: 28,
                              textAlign: 'right',
                              userSelect: 'none',
                            }}
                          >
                            {idx + 1}.
                          </span>
                          <span>{id}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* 2. Structured Property Changes Table */}
            {propertyDiffs.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: 'var(--muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    marginBottom: 6,
                  }}
                >
                  Property Changes ({propertyDiffs.length})
                </div>
                <div
                  style={{
                    borderRadius: 'var(--r, 6px)',
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                  }}
                >
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr
                        style={{
                          background: 'var(--surface-2)',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <th
                          style={{
                            textAlign: 'left',
                            padding: '6px 10px',
                            fontWeight: 600,
                            color: 'var(--muted)',
                            fontSize: 11,
                            width: '26%',
                          }}
                        >
                          Property
                        </th>
                        <th
                          style={{
                            textAlign: 'left',
                            padding: '6px 10px',
                            fontWeight: 600,
                            color: 'var(--muted)',
                            fontSize: 11,
                            width: '37%',
                          }}
                        >
                          Previous value
                        </th>
                        <th
                          style={{
                            textAlign: 'left',
                            padding: '6px 10px',
                            fontWeight: 600,
                            color: 'var(--muted)',
                            fontSize: 11,
                            width: '37%',
                          }}
                        >
                          New value
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {propertyDiffs.map((row) => (
                        <tr key={row.key} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 10px', fontWeight: 500, color: 'var(--ink)' }}>
                            {row.label}
                          </td>
                          <td style={{ padding: '6px 10px', color: 'var(--muted)' }}>
                            {row.status === 'added' ? (
                              <span style={{ fontStyle: 'italic', opacity: 0.6 }}>(none)</span>
                            ) : (
                              renderCellValue(row.beforeVal, row.status === 'changed')
                            )}
                          </td>
                          <td style={{ padding: '6px 10px' }}>
                            {row.status === 'removed' ? (
                              <span
                                style={{ color: 'var(--danger-ink, #ef4444)', fontStyle: 'italic' }}
                              >
                                Removed
                              </span>
                            ) : row.status === 'added' ? (
                              renderCellValue(row.afterVal, false, 'var(--success-ink, #22c55e)')
                            ) : (
                              renderCellValue(row.afterVal, false, 'var(--ink)')
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Audit Request & Network Metadata Strip */}
        {hasMetadata && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px 18px',
              marginTop: 10,
              paddingTop: 8,
              borderTop: '1px solid var(--border)',
              fontSize: 11,
              color: 'var(--muted)',
              alignItems: 'center',
            }}
          >
            {item.ipAddress && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span>🌐</span>
                <span style={{ color: 'var(--muted)' }}>IP:</span>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink)' }}>
                  {item.ipAddress}
                </span>
              </div>
            )}

            {item.requestId && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span>🔖</span>
                <span style={{ color: 'var(--muted)' }}>Request ID:</span>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink)' }}>
                  {item.requestId.slice(0, 14)}…
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(item.requestId ?? '');
                    toast({ title: 'Request ID copied' });
                  }}
                  title="Copy full Request ID"
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: 'var(--muted)',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Icon.Copy style={{ width: 10, height: 10 }} />
                </button>
              </div>
            )}

            {item.userAgent && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span>💻</span>
                <span style={{ color: 'var(--muted)' }}>Client:</span>
                <span
                  title={item.userAgent}
                  style={{
                    color: 'var(--ink)',
                    cursor: 'help',
                    borderBottom: '1px dotted var(--muted)',
                  }}
                >
                  {formatUserAgent(item.userAgent)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ marginBottom: 4 }}>Activity Logs</h1>
          <p className="lede" style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>
            <strong>{loading ? 'Loading…' : `${total.toLocaleString()} logged events`}</strong> ·
            Actions performed through the admin panel.
            <span
              title="Direct database access is not captured here."
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: 6,
                cursor: 'help',
                opacity: 0.7,
              }}
            >
              ℹ
            </span>
          </p>
        </div>
        <div className="head-tools">
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => void fetchLogs()}
            disabled={loading}
            title="Refresh activity logs"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <span
              style={{
                display: 'inline-block',
                animation: loading ? 'spin 0.8s linear infinite' : 'none',
              }}
            >
              <Icon.Refresh />
            </span>
            Refresh
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filter-card" style={{ marginBottom: 14 }}>
        <div className="filter-row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          {/* 1. Quick Search Record ID */}
          <div
            className="filter-search-box"
            style={{ minWidth: 220, maxWidth: 300, flex: '1 1 240px' }}
          >
            <Icon.Search />
            <input
              type="text"
              placeholder="Search Record ID…"
              value={resourceIdFilter}
              onChange={(e) => {
                setResourceIdFilter(e.target.value);
                setPage(1);
              }}
            />
            {resourceIdFilter && (
              <button
                type="button"
                className="filter-clear-btn"
                onClick={() => {
                  setResourceIdFilter('');
                  setPage(1);
                }}
                title="Clear search"
              >
                <Icon.Close />
              </button>
            )}
          </div>

          {/* 2. Action Filter */}
          <SearchableSelect
            options={ACTION_OPTIONS.map((opt) => ({ id: opt.value, label: opt.label }))}
            value={actionFilter}
            onChange={(v) => {
              setActionFilter(v);
              setPage(1);
            }}
            emptyLabel="All activity"
            ariaLabel="Filter by Activity"
            style={{ minWidth: 160 }}
          />

          {/* 3. Category Filter */}
          <SearchableSelect
            options={RESOURCE_TYPE_OPTIONS.map((opt) => ({ id: opt.value, label: opt.label }))}
            value={resourceTypeFilter}
            onChange={(v) => {
              setResourceTypeFilter(v);
              setPage(1);
            }}
            emptyLabel="All categories"
            ariaLabel="Filter by Category"
            style={{ minWidth: 160 }}
          />

          {/* 4. Date Range Popover */}
          <div ref={dateMenuRef} className="filter-popover-wrapper">
            <button
              type="button"
              className={`filter-toggle-btn ${startDateFilter || endDateFilter ? 'active' : ''}`}
              onClick={() => setDateOpen(!dateOpen)}
              style={{ height: 36, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <span>Date: {getDateLabel()}</span>
              <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
            </button>

            {dateOpen && (
              <div className="filter-popover-menu" style={{ width: 280 }}>
                <div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      display: 'block',
                      marginBottom: 8,
                    }}
                  >
                    Quick presets
                  </span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <button
                      type="button"
                      className={`btn sm ${datePreset === 'all' ? 'primary' : 'ghost'}`}
                      onClick={() => applyDatePreset('all')}
                    >
                      All time
                    </button>
                    <button
                      type="button"
                      className={`btn sm ${datePreset === 'today' ? 'primary' : 'ghost'}`}
                      onClick={() => applyDatePreset('today')}
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      className={`btn sm ${datePreset === '7d' ? 'primary' : 'ghost'}`}
                      onClick={() => applyDatePreset('7d')}
                    >
                      Last 7 days
                    </button>
                    <button
                      type="button"
                      className={`btn sm ${datePreset === '30d' ? 'primary' : 'ghost'}`}
                      onClick={() => applyDatePreset('30d')}
                    >
                      Last 30 days
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    borderTop: '1px solid var(--border)',
                    paddingTop: 10,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      display: 'block',
                      marginBottom: 6,
                    }}
                  >
                    Custom range
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)', width: 36 }}>From:</span>
                      <input
                        type="date"
                        className="input sm"
                        value={startDateFilter}
                        onChange={(e) => {
                          setStartDateFilter(e.target.value);
                          setDatePreset('custom');
                        }}
                        style={{ flex: 1 }}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)', width: 36 }}>To:</span>
                      <input
                        type="date"
                        className="input sm"
                        value={endDateFilter}
                        onChange={(e) => {
                          setEndDateFilter(e.target.value);
                          setDatePreset('custom');
                        }}
                        style={{ flex: 1 }}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        setDateOpen(false);
                        setPage(1);
                      }}
                      style={{ marginTop: 4 }}
                    >
                      Apply custom range
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 5. Advanced Filters Popover */}
          <div ref={idMenuRef} className="filter-popover-wrapper">
            <button
              type="button"
              className={`filter-toggle-btn ${actorFilter ? 'active' : ''}`}
              onClick={() => setIdLookupOpen(!idLookupOpen)}
              style={{ height: 36, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon.Filter />
              <span>More filters</span>
              {actorFilter && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    display: 'inline-block',
                  }}
                />
              )}
            </button>

            {idLookupOpen && (
              <div className="filter-popover-menu" style={{ width: 320 }}>
                <div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      display: 'block',
                      marginBottom: 6,
                    }}
                  >
                    Filter by Team Member User ID
                  </span>
                  <input
                    type="text"
                    placeholder="Enter Team Member User UUID…"
                    value={actorFilter}
                    onChange={(e) => {
                      setActorFilter(e.target.value);
                      setActorFilterLabel('');
                    }}
                    className="filter-input"
                    style={{ width: '100%' }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => {
                      setActorFilter('');
                      setActorFilterLabel('');
                      setPage(1);
                      setIdLookupOpen(false);
                    }}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={() => {
                      setPage(1);
                      setIdLookupOpen(false);
                    }}
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 6. Clear All Filters */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="btn sm ghost"
              style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Icon.Close /> Clear all
            </button>
          )}
        </div>

        {/* Active Filter Chips */}
        {hasActiveFilters && (
          <div className="filter-chips-row" style={{ marginTop: 8 }}>
            <span style={{ color: 'var(--muted)', fontSize: 11.5, marginRight: 2 }}>Active:</span>
            {resourceIdFilter && (
              <span className="filter-chip">
                Record ID:{' '}
                <strong>
                  {resourceIdFilter.length > 14
                    ? `${resourceIdFilter.slice(0, 12)}…`
                    : resourceIdFilter}
                </strong>
                <button
                  type="button"
                  className="filter-chip-remove"
                  onClick={() => {
                    setResourceIdFilter('');
                    setPage(1);
                  }}
                  title="Remove record ID filter"
                >
                  <Icon.Close />
                </button>
              </span>
            )}
            {actorFilter && (
              <span className="filter-chip">
                Team member: <strong>{actorFilterLabel || actorFilter}</strong>
                <button
                  type="button"
                  className="filter-chip-remove"
                  onClick={() => {
                    setActorFilter('');
                    setActorFilterLabel('');
                    setPage(1);
                  }}
                  title="Remove actor filter"
                >
                  <Icon.Close />
                </button>
              </span>
            )}
            {actionFilter && (
              <span className="filter-chip">
                Activity:{' '}
                <strong>
                  {ACTION_OPTIONS.find((o) => o.value === actionFilter)?.label || actionFilter}
                </strong>
                <button
                  type="button"
                  className="filter-chip-remove"
                  onClick={() => {
                    setActionFilter('');
                    setPage(1);
                  }}
                  title="Remove activity filter"
                >
                  <Icon.Close />
                </button>
              </span>
            )}
            {resourceTypeFilter && (
              <span className="filter-chip">
                Category:{' '}
                <strong>
                  {RESOURCE_TYPE_OPTIONS.find((o) => o.value === resourceTypeFilter)?.label ||
                    resourceTypeFilter}
                </strong>
                <button
                  type="button"
                  className="filter-chip-remove"
                  onClick={() => {
                    setResourceTypeFilter('');
                    setPage(1);
                  }}
                  title="Remove category filter"
                >
                  <Icon.Close />
                </button>
              </span>
            )}
            {(startDateFilter || endDateFilter) && (
              <span className="filter-chip">
                Date: <strong>{getDateLabel()}</strong>
                <button
                  type="button"
                  className="filter-chip-remove"
                  onClick={() => {
                    setStartDateFilter('');
                    setEndDateFilter('');
                    setDatePreset('all');
                    setPage(1);
                  }}
                  title="Remove date filter"
                >
                  <Icon.Close />
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Desktop Table View */}
      <div className="desktop-only table-wrap">
        <table>
          <thead>
            <tr>
              <th
                style={{
                  width: 150,
                  textTransform: 'uppercase',
                  fontSize: 11,
                  letterSpacing: '0.04em',
                  color: 'var(--muted)',
                  fontWeight: 600,
                }}
              >
                When
              </th>
              <th
                style={{
                  width: 220,
                  textTransform: 'uppercase',
                  fontSize: 11,
                  letterSpacing: '0.04em',
                  color: 'var(--muted)',
                  fontWeight: 600,
                }}
              >
                Team Member
              </th>
              <th
                style={{
                  textTransform: 'uppercase',
                  fontSize: 11,
                  letterSpacing: '0.04em',
                  color: 'var(--muted)',
                  fontWeight: 600,
                }}
              >
                What Happened
              </th>
              <th
                style={{
                  textAlign: 'right',
                  width: 140,
                  paddingRight: 16,
                  textTransform: 'uppercase',
                  fontSize: 11,
                  letterSpacing: '0.04em',
                  color: 'var(--muted)',
                  fontWeight: 600,
                }}
              >
                Details
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={4}
                  style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}
                >
                  Loading activity logs…
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}
                >
                  No activity found matching the selected filters.
                </td>
              </tr>
            ) : (
              logs.map((log) => {
                const isExpanded = expandedLogId === log.id;
                const cat = getActionCategory(log.action);
                const hasDetails =
                  Boolean(log.before) ||
                  Boolean(log.after) ||
                  Boolean(log.ipAddress) ||
                  Boolean(log.userAgent) ||
                  Boolean(log.requestId);

                return (
                  <Fragment key={log.id}>
                    <tr
                      style={{
                        background: isExpanded
                          ? 'rgba(var(--primary-rgb, 99, 102, 241), 0.05)'
                          : undefined,
                        borderLeft: isExpanded
                          ? '3px solid var(--accent, #6366f1)'
                          : '3px solid transparent',
                      }}
                    >
                      <td
                        style={{
                          fontSize: 12.5,
                          whiteSpace: 'nowrap',
                          color: 'var(--muted)',
                        }}
                      >
                        {formatDate(log.createdAt)}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() =>
                            filterByActor(
                              log.actorUserId,
                              log.actorEmail ?? log.actorDisplayName ?? log.actorUserId,
                            )
                          }
                          title="Filter to this team member"
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            fontWeight: 500,
                            color: 'var(--ink)',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            textDecorationStyle: 'dotted',
                            fontSize: 13,
                          }}
                        >
                          {log.actorEmail ?? log.actorDisplayName ?? log.actorUserId}
                        </button>
                        <div style={{ marginTop: 2 }}>
                          <span className="badge" style={{ fontSize: 10.5 }}>
                            {log.actorRole}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            title={cat}
                            style={{
                              display: 'inline-block',
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: ACTION_CATEGORY_DOT[cat],
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>
                            {describeAction(log)}
                          </span>
                        </div>
                        {log.resourceId && (
                          <div style={{ marginTop: 3 }}>
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard.writeText(log.resourceId ?? '');
                                toast({ title: 'Record ID copied to clipboard' });
                              }}
                              title="Click to copy full record ID"
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                cursor: 'pointer',
                                color: 'var(--muted)',
                                fontSize: 11,
                                fontFamily: 'var(--mono)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <span>{log.resourceId.slice(0, 12)}…</span>
                              <Icon.Copy style={{ width: 11, height: 11, opacity: 0.6 }} />
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', paddingRight: 16 }}>
                        {hasDetails ? (
                          <button
                            type="button"
                            className={`btn sm ${isExpanded ? 'secondary' : 'ghost'}`}
                            onClick={() => {
                              if (isExpanded) {
                                closeExpanded();
                                setExpandedIdKey(null);
                              } else {
                                setExpandedLogId(log.id);
                                setExpandedIdKey(null);
                              }
                            }}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 12,
                            }}
                          >
                            <span>{isExpanded ? 'Hide details ↑' : 'View details →'}</span>
                          </button>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                        )}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr
                        key={`${log.id}-detail`}
                        style={{
                          background: 'rgba(var(--primary-rgb, 99, 102, 241), 0.03)',
                          borderLeft: '3px solid var(--accent, #6366f1)',
                        }}
                      >
                        <td
                          colSpan={4}
                          style={{
                            padding: '4px 16px 10px 16px',
                            borderTop: 'none',
                          }}
                        >
                          {renderLogDetails(log)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile & Tablet Card View */}
      <div className="mobile-only" style={{ gap: 10 }}>
        {loading ? (
          <div
            className="card"
            style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}
          >
            Loading activity logs…
          </div>
        ) : logs.length === 0 ? (
          <div
            className="card"
            style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}
          >
            No activity found matching the selected filters.
          </div>
        ) : (
          logs.map((log) => {
            const isMobileExpanded = expandedLogId === log.id;

            return (
              <div
                key={log.id}
                className="card"
                style={{
                  padding: '12px 14px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r)',
                  background: 'var(--surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div
                  onClick={() => {
                    if (isMobileExpanded) {
                      closeExpanded();
                      setExpandedIdKey(null);
                    } else {
                      setExpandedLogId(log.id);
                      setExpandedIdKey(null);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: 13.5,
                          color: 'var(--ink)',
                          wordBreak: 'break-word',
                        }}
                      >
                        {log.actorEmail ?? log.actorDisplayName ?? log.actorUserId}
                      </span>
                      <span className="badge" style={{ fontSize: 10 }}>
                        {log.actorRole}
                      </span>
                    </div>
                    <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                      {formatDate(log.createdAt)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      color: 'var(--muted)',
                      transform: isMobileExpanded ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.15s ease',
                    }}
                  >
                    <Icon.Chevron />
                  </div>
                </div>

                {isMobileExpanded && <div style={{ paddingTop: 4 }}>{renderLogDetails(log)}</div>}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 16,
            paddingTop: 12,
            borderTop: '1px solid var(--border)',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            Showing{' '}
            <strong>
              {startItem.toLocaleString()}–{endItem.toLocaleString()}
            </strong>{' '}
            of <strong>{total.toLocaleString()}</strong> events
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              className="btn sm ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ‹ Previous
            </button>
            <span style={{ padding: '0 8px', fontSize: 12.5, color: 'var(--muted)' }}>
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              className="btn sm ghost"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next ›
            </button>
          </div>
        </div>
      )}
    </>
  );
}
