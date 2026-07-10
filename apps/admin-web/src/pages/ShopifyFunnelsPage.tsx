import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/Icons';
import { apiFetch } from '../lib/data';

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
  sortOrder: number;
}

interface Props {
  toast: (opts: { title: string; description?: string }) => void;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export default function ShopifyFunnelsPage({ toast }: Props) {
  const [items, setItems] = useState<FunnelTemplate[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

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

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiFetch<{ items: FunnelTemplate[] }>('/admin/shopify/funnel-templates'),
      apiFetch<WorkflowOption[]>('/admin/workflows'),
    ])
      .then(([f, w]) => {
        setItems(f.items);
        setWorkflows(w);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>Shopify</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Global, admin-owned labels merchants assign their Shopify products to. Each maps to one
            workflow template.
          </p>
        </div>
        <button type="button" className="btn primary" onClick={() => setShowCreate(true)}>
          <Icon.Plus /> New funnel template
        </button>
      </div>

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
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={creating ? undefined : () => setShowCreate(false)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(420px, calc(100vw - 40px))' }}
          >
            <div className="modal-head">
              <h3>New funnel template</h3>
              <button
                className="btn sm ghost"
                onClick={() => setShowCreate(false)}
                disabled={creating}
                style={{ marginLeft: 'auto' }}
              >
                <Icon.Close />
              </button>
            </div>
            <div
              className="modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
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
                  placeholder="snake_case"
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(slugify(e.target.value));
                  }}
                />
              </div>
              <div className="field">
                <label>Workflow</label>
                <select
                  className="select"
                  value={workflowTemplateId}
                  disabled={creating}
                  onChange={(e) => setWorkflowTemplateId(e.target.value)}
                >
                  <option value="">Select a workflow</option>
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label}
                    </option>
                  ))}
                </select>
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
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => setShowCreate(false)}
                disabled={creating}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={creating || !slug || !label || !workflowTemplateId}
                onClick={create}
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingItem && (
        <div
          className="modal-overlay"
          onClick={editSaving ? undefined : () => setEditingItem(null)}
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(420px, calc(100vw - 40px))' }}
          >
            <div className="modal-head">
              <h3>Edit funnel template</h3>
              <button
                className="btn sm ghost"
                onClick={() => setEditingItem(null)}
                disabled={editSaving}
                style={{ marginLeft: 'auto' }}
              >
                <Icon.Close />
              </button>
            </div>
            <div
              className="modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
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
                <select
                  className="select"
                  value={editWorkflowTemplateId}
                  disabled={editSaving}
                  onChange={(e) => setEditWorkflowTemplateId(e.target.value)}
                >
                  <option value="">Select a workflow</option>
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label}
                    </option>
                  ))}
                </select>
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
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => setEditingItem(null)}
                disabled={editSaving}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={editSaving || !editLabel || !editWorkflowTemplateId}
                onClick={saveEdit}
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
