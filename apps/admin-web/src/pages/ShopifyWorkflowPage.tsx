import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '../components/SearchableSelect';
import { apiErrorMessage, apiFetch } from '../lib/data';

interface WorkflowRow {
  id: string;
  label: string;
  workflowType: string;
  isActive: boolean;
}

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function ShopifyWorkflowPage({ toast }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [saved, setSaved] = useState('');
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<WorkflowRow[]>('/admin/workflows'),
      apiFetch<{ shopifyWorkflowTemplateId?: string | null }>('/admin/config'),
    ])
      .then(([rows, cfg]) => {
        setWorkflows(rows);
        const id = cfg.shopifyWorkflowTemplateId ?? '';
        setSaved(id);
        setSelected(id);
      })
      .catch((e) =>
        toast({
          kind: 'error',
          title: 'Failed to load Shopify workflow',
          body: apiErrorMessage(e, 'Please try again.'),
        }),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  const options = useMemo(
    () =>
      workflows
        .filter((w) => w.isActive || w.id === saved)
        .map((w) => ({
          id: w.id,
          label: `${w.label} (${w.workflowType})${w.isActive ? '' : ' — inactive'}`,
        })),
    [workflows, saved],
  );

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await apiFetch('/admin/config', {
        method: 'PATCH',
        body: JSON.stringify({ shopifyWorkflowTemplateId: selected }),
      });
      setSaved(selected);
      toast({ title: 'Shopify workflow saved' });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to save Shopify workflow',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card settings-card">
      <div className="card-head">
        <h3>Shopify workflow</h3>
      </div>
      <div className="card-body">
        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            <div className="setting-desc" style={{ marginBottom: 12 }}>
              Every Shopify try-on runs this workflow. Until one is chosen, try-ons use the previous
              default style&apos;s workflow.
            </div>
            <SearchableSelect
              ariaLabel="Shopify workflow"
              options={options}
              value={selected}
              onChange={setSelected}
              placeholder="Choose a workflow"
            />
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn primary"
                onClick={save}
                disabled={saving || !selected || selected === saved}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
