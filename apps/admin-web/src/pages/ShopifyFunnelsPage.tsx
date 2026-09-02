import { useCallback, useEffect, useState } from 'react';
import { ConfirmModal } from '../components/ConfirmModal';
import { EditDrawer } from '../components/EditDrawer';
import { Icon } from '../components/Icons';
import { SearchableSelect } from '../components/SearchableSelect';
import { ApiError, apiErrorMessage, apiFetch } from '../lib/data';

interface WorkflowOption {
  id: string;
  label: string;
}

interface FunnelTemplate {
  id: string;
  slug: string;
  label: string;
  workflowTemplateId: string;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
}

type ConditionField = 'product_type' | 'tags' | 'vendor' | 'collections';
type ConditionOperator = 'equals' | 'contains';

interface Condition {
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
}

interface GlobalRule {
  id: string;
  funnelTemplateId: string;
  conditions: Condition[];
  priority: number;
  disabledByStoreCount: number;
}

interface Props {
  toast: (opts: { kind?: 'error'; title: string; body?: string }) => void;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Mirrors the merchant-facing condition schema (apps/shopify/src/pages/RoutingPage.tsx,
// itself mirroring apps/api/src/modules/admin/shopify-funnel-rules.routes.ts's Zod
// schemas) so a global rule reads the same way here as it does in the store's own
// routing page.
const CONDITION_FIELD_LABEL: Record<ConditionField, string> = {
  product_type: 'Product type',
  tags: 'Tag',
  vendor: 'Vendor',
  collections: 'Collection',
};
const CONDITION_FIELD_OPTIONS = Object.keys(CONDITION_FIELD_LABEL) as ConditionField[];
const CONDITION_OPERATOR_LABEL: Record<ConditionOperator, string> = {
  equals: 'is',
  contains: 'contains',
};
const MIN_CONDITIONS = 1;
const MAX_CONDITIONS = 20;
const MAX_CONDITION_VALUE_LENGTH = 200;

function emptyCondition(): Condition {
  return { field: 'product_type', operator: 'equals', value: '' };
}

/** "Tag contains "saree" or Product type is "Saree"" — the admin never sees the raw
 *  condition objects, only this. */
function describeConditions(conditions: Condition[]): string {
  if (conditions.length === 0) return 'Matches nothing — add a condition';
  return conditions
    .map(
      (c) =>
        `${CONDITION_FIELD_LABEL[c.field]} ${CONDITION_OPERATOR_LABEL[c.operator]} "${c.value}"`,
    )
    .join(' or ');
}

// shopify_funnel_rules cascades on funnel_template_id (schema/shopify.ts), so deleting a
// basket silently deletes every store's rules for it. storesAffected is a countDistinct
// over store-scoped rules only — Postgres COUNT(DISTINCT ...) skips NULL, so it says
// nothing about a global rule (storeId IS NULL), which affects every store that hasn't
// individually suppressed it. hasGlobalRule carries that signal separately (Task 7's
// fix round) rather than folding it into a store count that would understate the impact.
function describeCascade(
  rulesAffected: number,
  storesAffected: number,
  hasGlobalRule: boolean,
): string | undefined {
  if (rulesAffected === 0) return undefined;
  const rulePart = `${rulesAffected} routing rule${rulesAffected === 1 ? '' : 's'}`;
  const storePart =
    storesAffected > 0 ? ` across ${storesAffected} store${storesAffected === 1 ? '' : 's'}` : '';
  const base = `Also deleted ${rulePart}${storePart}.`;
  return hasGlobalRule
    ? `${base} That includes a global rule affecting every store that hasn't switched it off.`
    : base;
}

function ConditionsEditor({
  conditions,
  onChange,
  disabled,
}: {
  conditions: Condition[];
  onChange: (next: Condition[]) => void;
  disabled?: boolean;
}) {
  function update(index: number, patch: Partial<Condition>) {
    onChange(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }
  function remove(index: number) {
    onChange(conditions.filter((_, i) => i !== index));
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {conditions.map((condition, idx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable identity of their own until saved — index is fine for a client-only draft list that's never reordered (mirrors apps/shopify/src/pages/RoutingPage.tsx).
        <div key={idx} style={{ display: 'flex', gap: 8 }}>
          <select
            className="select"
            style={{ flex: '0 0 140px' }}
            value={condition.field}
            disabled={disabled}
            aria-label="Field"
            onChange={(e) => update(idx, { field: e.target.value as ConditionField })}
          >
            {CONDITION_FIELD_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {CONDITION_FIELD_LABEL[f]}
              </option>
            ))}
          </select>
          <select
            className="select"
            style={{ flex: '0 0 110px' }}
            value={condition.operator}
            disabled={disabled}
            aria-label="Match"
            onChange={(e) => update(idx, { operator: e.target.value as ConditionOperator })}
          >
            <option value="equals">is</option>
            <option value="contains">contains</option>
          </select>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Value"
            value={condition.value}
            disabled={disabled}
            maxLength={MAX_CONDITION_VALUE_LENGTH}
            aria-label="Value"
            onChange={(e) => update(idx, { value: e.target.value })}
          />
          <button
            type="button"
            className="btn sm ghost"
            disabled={disabled || conditions.length <= MIN_CONDITIONS}
            onClick={() => remove(idx)}
            title="Remove this condition"
          >
            <Icon.Trash />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn sm ghost"
        style={{ alignSelf: 'flex-start' }}
        disabled={disabled || conditions.length >= MAX_CONDITIONS}
        onClick={() => onChange([...conditions, emptyCondition()])}
      >
        <Icon.Plus /> Add condition
      </button>
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted)' }}>
        A product matches this rule if any one condition above is true.
      </p>
    </div>
  );
}

export default function ShopifyFunnelsPage({ toast }: Props) {
  const [items, setItems] = useState<FunnelTemplate[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [hasDefault, setHasDefault] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [slug, setSlug] = useState('');
  const [label, setLabel] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [workflowTemplateId, setWorkflowTemplateId] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [creating, setCreating] = useState(false);

  const [editingItem, setEditingItem] = useState<FunnelTemplate | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editWorkflowTemplateId, setEditWorkflowTemplateId] = useState('');
  const [editSortOrder, setEditSortOrder] = useState(0);
  const [editSaving, setEditSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<FunnelTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [reassignSource, setReassignSource] = useState<FunnelTemplate | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState('');
  const [reassigning, setReassigning] = useState(false);
  // true when opened via a blocked delete (reassign, then delete the source);
  // false when opened via the standalone "Move products" action (reassign only).
  const [reassignThenDelete, setReassignThenDelete] = useState(true);

  const [rules, setRules] = useState<GlobalRule[]>([]);

  const [showCreateRule, setShowCreateRule] = useState(false);
  const [ruleFunnelTemplateId, setRuleFunnelTemplateId] = useState('');
  const [ruleConditions, setRuleConditions] = useState<Condition[]>([emptyCondition()]);
  const [rulePriority, setRulePriority] = useState(0);
  const [ruleSaving, setRuleSaving] = useState(false);

  const [editingRule, setEditingRule] = useState<GlobalRule | null>(null);
  const [editRuleConditions, setEditRuleConditions] = useState<Condition[]>([]);
  const [editRulePriority, setEditRulePriority] = useState(0);
  const [editRuleSaving, setEditRuleSaving] = useState(false);

  const [confirmDeleteRule, setConfirmDeleteRule] = useState<GlobalRule | null>(null);
  const [deletingRule, setDeletingRule] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiFetch<{ items: FunnelTemplate[]; hasDefault: boolean }>('/admin/shopify/funnel-templates'),
      apiFetch<WorkflowOption[]>('/admin/workflows'),
      apiFetch<{ items: GlobalRule[] }>('/admin/shopify/funnel-rules'),
    ])
      .then(([f, w, r]) => {
        setItems(f.items);
        setHasDefault(f.hasDefault);
        setWorkflows(w);
        setRules(r.items);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetCreateForm() {
    setSlug('');
    setLabel('');
    setSlugTouched(false);
    setWorkflowTemplateId('');
    setSortOrder(0);
  }

  async function create() {
    if (!slug || !label || !workflowTemplateId) return;
    setCreating(true);
    try {
      await apiFetch('/admin/shopify/funnel-templates', {
        method: 'POST',
        body: JSON.stringify({ slug, label, workflowTemplateId, sortOrder }),
      });
      toast({ title: 'Funnel template created' });
      resetCreateForm();
      setShowCreate(false);
      load();
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to create funnel template',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(item: FunnelTemplate) {
    setTogglingId(item.id);
    try {
      await apiFetch(`/admin/shopify/funnel-templates/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      load();
    } finally {
      setTogglingId(null);
    }
  }

  async function makeDefault(item: FunnelTemplate) {
    setTogglingId(item.id);
    try {
      await apiFetch(`/admin/shopify/funnel-templates/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDefault: true }),
      });
      load();
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Could not set default',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setTogglingId(null);
    }
  }

  function openEdit(item: FunnelTemplate) {
    setEditingItem(item);
    setEditLabel(item.label);
    setEditWorkflowTemplateId(item.workflowTemplateId);
    setEditSortOrder(item.sortOrder);
  }

  async function saveEdit() {
    if (!editingItem || !editLabel || !editWorkflowTemplateId) return;
    setEditSaving(true);
    try {
      await apiFetch(`/admin/shopify/funnel-templates/${editingItem.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          label: editLabel,
          workflowTemplateId: editWorkflowTemplateId,
          sortOrder: editSortOrder,
        }),
      });
      toast({ title: 'Funnel template updated' });
      setEditingItem(null);
      load();
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      // The cascade counts (rulesAffected/storesAffected/hasGlobalRule) are computed by
      // the API just before it deletes and only reach the client in this response — there
      // is no preview/dry-run endpoint, so the exact numbers can only be stated after the
      // delete has already happened, not in the confirm dialog beforehand.
      const result = await apiFetch<{
        ok: boolean;
        rulesAffected: number;
        storesAffected: number;
        hasGlobalRule: boolean;
      }>(`/admin/shopify/funnel-templates/${confirmDelete.id}`, { method: 'DELETE' });
      toast({
        title: `${confirmDelete.label} deleted`,
        body: describeCascade(result.rulesAffected, result.storesAffected, result.hasGlobalRule),
      });
      load();
      setConfirmDelete(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Products are still assigned — offer to move them to another funnel
        // template first instead of just reporting the block.
        setReassignSource(confirmDelete);
        setReassignTargetId('');
        setReassignThenDelete(true);
        setConfirmDelete(null);
      } else {
        toast({
          kind: 'error',
          title: 'Failed to delete funnel template',
          body: apiErrorMessage(err, 'Please try again.'),
        });
        setConfirmDelete(null);
      }
    } finally {
      setDeleting(false);
    }
  }

  function openMove(item: FunnelTemplate) {
    setReassignSource(item);
    setReassignTargetId('');
    setReassignThenDelete(false);
  }

  async function handleReassignAndDelete() {
    if (!reassignSource || !reassignTargetId) return;
    setReassigning(true);
    try {
      const { reassigned } = await apiFetch<{ ok: boolean; reassigned: number }>(
        `/admin/shopify/funnel-templates/${reassignSource.id}/reassign`,
        { method: 'POST', body: JSON.stringify({ targetId: reassignTargetId }) },
      );
      if (reassignThenDelete) {
        const result = await apiFetch<{
          ok: boolean;
          rulesAffected: number;
          storesAffected: number;
          hasGlobalRule: boolean;
        }>(`/admin/shopify/funnel-templates/${reassignSource.id}`, { method: 'DELETE' });
        const cascade = describeCascade(
          result.rulesAffected,
          result.storesAffected,
          result.hasGlobalRule,
        );
        toast({
          title: `${reassignSource.label} deleted`,
          body: [`${reassigned} product(s) moved to the selected funnel template.`, cascade]
            .filter(Boolean)
            .join(' '),
        });
      } else {
        toast({
          title: 'Products moved',
          body: `${reassigned} product(s) moved to the selected funnel template.`,
        });
      }
      setReassignSource(null);
      load();
    } catch (err) {
      toast({
        kind: 'error',
        title: reassignThenDelete ? 'Failed to reassign and delete' : 'Failed to move products',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setReassigning(false);
    }
  }

  function basketLabel(id: string): string {
    return items.find((i) => i.id === id)?.label ?? 'Unknown basket';
  }

  // Baskets a new global rule can target: must be active (the API 404s a create against
  // an inactive/nonexistent basket) and must not already have a global rule — the
  // partial unique index allows only one per basket, so offering a taken one would just
  // route the admin into a 409 ("edit it instead").
  const takenBasketIds = new Set(rules.map((r) => r.funnelTemplateId));
  const availableBasketsForNewRule = items.filter((i) => i.isActive && !takenBasketIds.has(i.id));

  function resetRuleForm() {
    setRuleFunnelTemplateId('');
    setRuleConditions([emptyCondition()]);
    setRulePriority(0);
  }

  async function createRule() {
    const trimmed = ruleConditions.map((c) => ({ ...c, value: c.value.trim() }));
    if (!ruleFunnelTemplateId || trimmed.length === 0 || trimmed.some((c) => !c.value)) return;
    setRuleSaving(true);
    try {
      await apiFetch('/admin/shopify/funnel-rules', {
        method: 'POST',
        body: JSON.stringify({
          funnelTemplateId: ruleFunnelTemplateId,
          conditions: trimmed,
          priority: rulePriority,
        }),
      });
      toast({ title: 'Global rule created' });
      resetRuleForm();
      setShowCreateRule(false);
      load();
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to create global rule',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setRuleSaving(false);
    }
  }

  function openEditRule(rule: GlobalRule) {
    setEditingRule(rule);
    setEditRuleConditions(rule.conditions.map((c) => ({ ...c })));
    setEditRulePriority(rule.priority);
  }

  async function saveEditRule() {
    if (!editingRule) return;
    const trimmed = editRuleConditions.map((c) => ({ ...c, value: c.value.trim() }));
    if (trimmed.length === 0 || trimmed.some((c) => !c.value)) return;
    setEditRuleSaving(true);
    try {
      await apiFetch(`/admin/shopify/funnel-rules/${editingRule.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ conditions: trimmed, priority: editRulePriority }),
      });
      toast({ title: 'Global rule updated' });
      setEditingRule(null);
      load();
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to update global rule',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setEditRuleSaving(false);
    }
  }

  async function handleDeleteRule() {
    if (!confirmDeleteRule) return;
    setDeletingRule(true);
    try {
      await apiFetch(`/admin/shopify/funnel-rules/${confirmDeleteRule.id}`, { method: 'DELETE' });
      toast({ title: 'Global rule deleted' });
      load();
      setConfirmDeleteRule(null);
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to delete global rule',
        body: apiErrorMessage(err, 'Please try again.'),
      });
      setConfirmDeleteRule(null);
    } finally {
      setDeletingRule(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div className="page-head">
        <div>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>Shopify</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Global, admin-owned labels merchants assign their Shopify products to. Each maps to one
            workflow template.
          </p>
        </div>
        <div className="head-tools">
          <button type="button" className="btn primary" onClick={() => setShowCreate(true)}>
            <Icon.Plus /> New funnel template
          </button>
        </div>
      </div>

      {!loading && !hasDefault && (
        <div className="banner" style={{ marginBottom: 16 }}>
          <div className="ic">
            <Icon.Warning />
          </div>
          <div>
            <b>No default funnel template.</b> Every Shopify try-on is refused until one template
            here is set as the default.
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div
          style={{ color: 'var(--muted)', fontSize: 13, padding: '32px 0', textAlign: 'center' }}
        >
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div
          style={{
            border: '1px dashed var(--border)',
            borderRadius: 8,
            padding: '48px 24px',
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: 13,
          }}
        >
          <Icon.Workflow />
          <p style={{ marginTop: 12 }}>No funnel templates yet. Add one to get started.</p>
          <button
            type="button"
            className="btn primary"
            style={{ marginTop: 12 }}
            onClick={() => setShowCreate(true)}
          >
            <Icon.Plus /> New funnel template
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Slug</th>
                <th>Workflow</th>
                <th style={{ textAlign: 'right' }}>Default</th>
                <th style={{ textAlign: 'right' }}>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td style={{ fontWeight: 500 }}>{item.label}</td>
                  <td>
                    <code
                      style={{
                        fontSize: 12,
                        background: 'var(--bg-2)',
                        padding: '2px 6px',
                        borderRadius: 4,
                      }}
                    >
                      {item.slug}
                    </code>
                  </td>
                  <td>{workflows.find((w) => w.id === item.workflowTemplateId)?.label ?? '?'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {item.isDefault ? (
                      <span style={{ fontWeight: 600 }}>Default</span>
                    ) : (
                      <button
                        type="button"
                        className="btn sm ghost"
                        disabled={togglingId === item.id || !item.isActive}
                        title={
                          item.isActive
                            ? 'Route every Shopify product through this workflow'
                            : 'Activate this template before making it the default'
                        }
                        onClick={() => makeDefault(item)}
                      >
                        {togglingId === item.id ? '…' : 'Set default'}
                      </button>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn sm ghost"
                      disabled={togglingId === item.id}
                      onClick={() => toggleActive(item)}
                    >
                      {togglingId === item.id ? '…' : item.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn sm ghost"
                      onClick={() => openEdit(item)}
                      title="Edit label, workflow, or sort order"
                    >
                      <Icon.Edit /> Edit
                    </button>{' '}
                    <button
                      type="button"
                      className="btn sm ghost"
                      onClick={() => openMove(item)}
                      title="Move this template's assigned products to another funnel template"
                    >
                      <Icon.Replace /> Move
                    </button>{' '}
                    <button
                      type="button"
                      className="btn sm ghost"
                      onClick={() => setConfirmDelete(item)}
                      title="Delete this funnel template"
                    >
                      <Icon.Trash /> Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Global rules */}
      <div className="card">
        <div className="card-head">
          <h3>Global rules</h3>
          <span className="sub">
            Auto-routes products by condition, applied to every store unless a store switches the
            rule off.
          </span>
          <div className="tools">
            <button
              type="button"
              className="btn sm primary"
              disabled={availableBasketsForNewRule.length === 0}
              title={
                availableBasketsForNewRule.length === 0
                  ? 'Every active basket already has a global rule'
                  : undefined
              }
              onClick={() => setShowCreateRule(true)}
            >
              <Icon.Plus /> New rule
            </button>
          </div>
        </div>
        <div className="card-body flush">
          {loading ? (
            <div
              style={{
                color: 'var(--muted)',
                fontSize: 13,
                padding: '32px 0',
                textAlign: 'center',
              }}
            >
              Loading…
            </div>
          ) : rules.length === 0 ? (
            <div
              style={{
                padding: '32px 24px',
                textAlign: 'center',
                color: 'var(--muted)',
                fontSize: 13,
              }}
            >
              No global rules yet. Unmatched products fall back to each store's own rules, then the
              default basket.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Basket</th>
                    <th>Conditions</th>
                    <th style={{ textAlign: 'right' }}>Priority</th>
                    <th style={{ textAlign: 'right' }}>Disabled by</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id}>
                      <td style={{ fontWeight: 500 }}>{basketLabel(rule.funnelTemplateId)}</td>
                      <td>{describeConditions(rule.conditions)}</td>
                      <td style={{ textAlign: 'right' }}>{rule.priority}</td>
                      <td style={{ textAlign: 'right' }}>
                        off for {rule.disabledByStoreCount} store
                        {rule.disabledByStoreCount === 1 ? '' : 's'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn sm ghost"
                          onClick={() => openEditRule(rule)}
                          title="Edit conditions or priority"
                        >
                          <Icon.Edit /> Edit
                        </button>{' '}
                        <button
                          type="button"
                          className="btn sm ghost"
                          onClick={() => setConfirmDeleteRule(rule)}
                          title="Delete this global rule"
                        >
                          <Icon.Trash /> Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create modal */}
      {showCreate && (
        <EditDrawer
          onClose={() => setShowCreate(false)}
          title="New funnel template"
          width="min(420px, calc(100vw - 40px))"
          saving={creating}
          onSave={create}
          saveLabel={creating ? 'Creating…' : 'Create'}
          saveDisabled={creating || !slug || !label || !workflowTemplateId}
        >
          <div className="field">
            <label>Label</label>
            <input
              className="input"
              value={label}
              disabled={creating}
              onChange={(e) => {
                const value = e.target.value;
                setLabel(value);
                if (!slugTouched) setSlug(slugify(value));
              }}
            />
          </div>
          <div className="field">
            <label>Slug</label>
            <input
              className="input"
              value={slug}
              disabled={creating}
              placeholder="kebab-case"
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
            />
          </div>
          <div className="field">
            <label>Workflow</label>
            <SearchableSelect
              options={workflows}
              value={workflowTemplateId}
              disabled={creating}
              onChange={setWorkflowTemplateId}
              placeholder="— search workflow —"
              emptyLabel="Select a workflow"
            />
          </div>
          <div className="field">
            <label>Sort order</label>
            <input
              className="input"
              type="number"
              value={sortOrder}
              disabled={creating}
              onChange={(e) => setSortOrder(Number(e.target.value))}
            />
          </div>
        </EditDrawer>
      )}

      {/* Edit modal */}
      {editingItem && (
        <EditDrawer
          onClose={() => setEditingItem(null)}
          title="Edit funnel template"
          subtitle={editingItem.slug}
          width="min(420px, calc(100vw - 40px))"
          saving={editSaving}
          onSave={saveEdit}
          saveLabel={editSaving ? 'Saving…' : 'Save'}
          saveDisabled={editSaving || !editLabel || !editWorkflowTemplateId}
        >
          <div className="field">
            <label>Slug</label>
            <input className="input" value={editingItem.slug} disabled />
          </div>
          <div className="field">
            <label>Label</label>
            <input
              className="input"
              value={editLabel}
              disabled={editSaving}
              onChange={(e) => setEditLabel(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Workflow</label>
            <SearchableSelect
              options={workflows}
              value={editWorkflowTemplateId}
              disabled={editSaving}
              onChange={setEditWorkflowTemplateId}
              placeholder="— search workflow —"
              emptyLabel="Select a workflow"
            />
          </div>
          <div className="field">
            <label>Sort order</label>
            <input
              className="input"
              type="number"
              value={editSortOrder}
              disabled={editSaving}
              onChange={(e) => setEditSortOrder(Number(e.target.value))}
            />
          </div>
        </EditDrawer>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete funnel template"
          body={
            <>
              Are you sure you want to delete "{confirmDelete.label}"? This cannot be undone. Any
              routing rules tied to this basket — store-specific or global — will be deleted with
              it.
              {rules.some((r) => r.funnelTemplateId === confirmDelete.id) && (
                <>
                  {' '}
                  This basket has a global rule, so the deletion will affect every store that hasn't
                  switched it off.
                </>
              )}
            </>
          }
          what={`slug: ${confirmDelete.slug}`}
          danger
          confirmLabel={deleting ? 'Deleting…' : 'Delete'}
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(null)}
        />
      )}

      {reassignSource && (
        <div
          className="modal-overlay"
          onClick={reassigning ? undefined : () => setReassignSource(null)}
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(420px, calc(100vw - 40px))' }}
          >
            <div className="modal-head">
              <h3>{reassignThenDelete ? 'Move products & delete' : 'Move products'}</h3>
              <button
                className="btn sm ghost"
                onClick={() => setReassignSource(null)}
                disabled={reassigning}
                style={{ marginLeft: 'auto' }}
              >
                <Icon.Close />
              </button>
            </div>
            <div
              className="modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
                {reassignThenDelete ? (
                  <>
                    "{reassignSource.label}" still has products assigned to it. Pick another funnel
                    template to move them to — they'll be reassigned, then "{reassignSource.label}"
                    will be deleted.
                  </>
                ) : (
                  <>
                    Pick another funnel template to move "{reassignSource.label}"'s assigned
                    products to. "{reassignSource.label}" itself won't be deleted.
                  </>
                )}
              </p>
              <div className="field">
                <label>Move products to</label>
                <SearchableSelect
                  options={items.filter((i) => i.id !== reassignSource.id)}
                  value={reassignTargetId}
                  disabled={reassigning}
                  onChange={setReassignTargetId}
                  placeholder="— search funnel template —"
                  emptyLabel="Select a funnel template"
                />
              </div>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => setReassignSource(null)}
                disabled={reassigning}
              >
                Cancel
              </button>
              <button
                className={reassignThenDelete ? 'btn danger' : 'btn primary'}
                disabled={reassigning || !reassignTargetId}
                onClick={handleReassignAndDelete}
              >
                {reassigning ? 'Moving…' : reassignThenDelete ? 'Move & delete' : 'Move'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global rule create modal */}
      {showCreateRule && (
        <EditDrawer
          onClose={() => setShowCreateRule(false)}
          title="New global rule"
          width="min(560px, calc(100vw - 40px))"
          saving={ruleSaving}
          onSave={createRule}
          saveLabel={ruleSaving ? 'Creating…' : 'Create'}
          saveDisabled={
            ruleSaving ||
            !ruleFunnelTemplateId ||
            ruleConditions.length === 0 ||
            ruleConditions.some((c) => !c.value.trim())
          }
        >
          <div className="field">
            <label>Basket</label>
            <SearchableSelect
              options={availableBasketsForNewRule}
              value={ruleFunnelTemplateId}
              disabled={ruleSaving}
              onChange={setRuleFunnelTemplateId}
              placeholder="— search basket —"
              emptyLabel="Select a basket"
            />
          </div>
          <div className="field">
            <label>Match products where</label>
            <ConditionsEditor
              conditions={ruleConditions}
              onChange={setRuleConditions}
              disabled={ruleSaving}
            />
          </div>
          <div className="field">
            <label>Priority</label>
            <input
              className="input"
              type="number"
              value={rulePriority}
              disabled={ruleSaving}
              onChange={(e) => setRulePriority(Number(e.target.value))}
            />
            <span className="hint">
              When a product matches more than one rule, the highest priority wins.
            </span>
          </div>
        </EditDrawer>
      )}

      {/* Global rule edit modal */}
      {editingRule && (
        <EditDrawer
          onClose={() => setEditingRule(null)}
          title="Edit global rule"
          subtitle={basketLabel(editingRule.funnelTemplateId)}
          width="min(560px, calc(100vw - 40px))"
          saving={editRuleSaving}
          onSave={saveEditRule}
          saveLabel={editRuleSaving ? 'Saving…' : 'Save'}
          saveDisabled={
            editRuleSaving ||
            editRuleConditions.length === 0 ||
            editRuleConditions.some((c) => !c.value.trim())
          }
        >
          <div className="field">
            <label>Basket</label>
            <input className="input" value={basketLabel(editingRule.funnelTemplateId)} disabled />
            <span className="hint">
              A rule's basket can't be changed after it's created — delete this rule and add a new
              one to route it elsewhere.
            </span>
          </div>
          <div className="field">
            <label>Match products where</label>
            <ConditionsEditor
              conditions={editRuleConditions}
              onChange={setEditRuleConditions}
              disabled={editRuleSaving}
            />
          </div>
          <div className="field">
            <label>Priority</label>
            <input
              className="input"
              type="number"
              value={editRulePriority}
              disabled={editRuleSaving}
              onChange={(e) => setEditRulePriority(Number(e.target.value))}
            />
          </div>
        </EditDrawer>
      )}

      {confirmDeleteRule && (
        <ConfirmModal
          title="Delete global rule"
          body={`Are you sure you want to delete this rule for "${basketLabel(confirmDeleteRule.funnelTemplateId)}"? This cannot be undone.`}
          what={describeConditions(confirmDeleteRule.conditions)}
          danger
          confirmLabel={deletingRule ? 'Deleting…' : 'Delete'}
          onConfirm={handleDeleteRule}
          onClose={() => setConfirmDeleteRule(null)}
        />
      )}
    </div>
  );
}
