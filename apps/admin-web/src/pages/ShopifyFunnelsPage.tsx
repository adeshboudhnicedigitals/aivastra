import { useCallback, useEffect, useState } from 'react';
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

export default function ShopifyFunnelsPage({ toast }: Props) {
  const [items, setItems] = useState<FunnelTemplate[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState('');
  const [label, setLabel] = useState('');
  const [workflowTemplateId, setWorkflowTemplateId] = useState('');
  const [sortOrder, setSortOrder] = useState(0);

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

  async function create() {
    if (!slug || !label || !workflowTemplateId) return;
    await apiFetch('/admin/shopify/funnel-templates', {
      method: 'POST',
      body: JSON.stringify({ slug, label, workflowTemplateId, sortOrder }),
    });
    toast({ title: 'Funnel template created' });
    setSlug('');
    setLabel('');
    setWorkflowTemplateId('');
    setSortOrder(0);
    load();
  }

  async function toggleActive(item: FunnelTemplate) {
    await apiFetch(`/admin/shopify/funnel-templates/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !item.isActive }),
    });
    load();
  }

  return (
    <div>
      <h1>Shopify Funnel Templates</h1>
      <p>
        Global, admin-owned labels merchants assign their Shopify products to. Each maps to one
        workflow template.
      </p>

      <div style={{ display: 'flex', gap: '8px', margin: '16px 0', alignItems: 'end' }}>
        <label>
          Slug
          <input value={slug} onChange={(e) => setSlug(e.target.value)} />
        </label>
        <label>
          Label
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label>
          Workflow
          <select
            value={workflowTemplateId}
            onChange={(e) => setWorkflowTemplateId(e.target.value)}
          >
            <option value="">Select a workflow</option>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort order
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
          />
        </label>
        <button type="button" onClick={create}>
          Add
        </button>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Slug</th>
              <th>Workflow</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.label}</td>
                <td>{item.slug}</td>
                <td>{workflows.find((w) => w.id === item.workflowTemplateId)?.label ?? '?'}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={item.isActive}
                    onChange={() => toggleActive(item)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
