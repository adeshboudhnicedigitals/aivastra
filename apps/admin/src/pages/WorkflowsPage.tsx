import { useState, useEffect, useCallback } from 'react';
import { Icon } from '../components/Icons';
import { ConfirmModal } from '../components/ConfirmModal';
import { WorkflowUploadModal } from '../components/WorkflowUploadModal';
import { apiFetch, ApiError } from '../lib/data';
import type { WorkflowOption } from '../types';

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
}

export default function WorkflowsPage({ toast }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null); // workflow id being confirmed
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<WorkflowOption[]>('/admin/workflows');
      setWorkflows(data);
    } catch {
      toast({ kind: 'error', title: 'Failed to load workflows' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  const handleCreated = (wf: WorkflowOption) => {
    setWorkflows((prev) => [wf, ...prev]);
    setShowUpload(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/admin/workflows/${id}`, { method: 'DELETE' });
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
      toast({ title: 'Workflow deleted' });
    } catch (e) {
      const msg = e instanceof ApiError
        ? ((e.body as { error?: { message?: string } })?.error?.message ?? 'Failed to delete workflow')
        : 'Failed to delete workflow';
      toast({ kind: 'error', title: msg });
    } finally {
      setDeleting(null);
    }
  };

  const handleToggleActive = async (wf: WorkflowOption) => {
    setTogglingId(wf.id);
    try {
      await apiFetch(`/admin/workflows/${wf.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !wf.isActive }),
      });
      setWorkflows((prev) => prev.map((w) => w.id === wf.id ? { ...w, isActive: !w.isActive } : w));
      toast({ title: `Workflow "${wf.label}" ${wf.isActive ? 'deactivated' : 'activated'}` });
    } catch {
      toast({ kind: 'error', title: 'Failed to update workflow' });
    } finally {
      setTogglingId(null);
    }
  };

  const deletingWorkflow = deleting ? workflows.find((w) => w.id === deleting) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>Workflows</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            ComfyUI workflow templates used for try-on generation. Each pose selects one workflow.
          </p>
        </div>
        <button className="btn primary" onClick={() => setShowUpload(true)}>
          <Icon.Plus />
          Add workflow
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>Loading…</div>
      ) : workflows.length === 0 ? (
        <div style={{
          border: '1px dashed var(--border)',
          borderRadius: 8,
          padding: '48px 24px',
          textAlign: 'center',
          color: 'var(--muted)',
          fontSize: 13,
        }}>
          <Icon.Workflow />
          <p style={{ marginTop: 12 }}>No workflows yet. Upload your first ComfyUI workflow JSON to get started.</p>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => setShowUpload(true)}>
            <Icon.Plus /> Add workflow
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Slug</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Poses</th>
                <th style={{ textAlign: 'right' }}>Created</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((wf) => (
                <tr key={wf.id}>
                  <td style={{ fontWeight: 500 }}>{wf.label}</td>
                  <td>
                    <code style={{ fontSize: 12, background: 'var(--bg-2)', padding: '2px 6px', borderRadius: 4 }}>
                      {wf.slug}
                    </code>
                  </td>
                  <td>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: wf.isActive ? 'var(--success-soft, rgba(76,175,80,0.12))' : 'var(--bg-2)',
                        color: wf.isActive ? 'var(--success, #4caf50)' : 'var(--muted)',
                      }}
                    >
                      {wf.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', color: wf.poseCount > 0 ? 'inherit' : 'var(--muted)' }}>
                    {wf.poseCount}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 12 }}>
                    {new Date(wf.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        className="btn sm ghost"
                        disabled={togglingId === wf.id}
                        onClick={() => handleToggleActive(wf)}
                        title={wf.isActive ? 'Deactivate' : 'Activate'}
                      >
                        {wf.isActive ? <Icon.Eye /> : <Icon.Eye />}
                        {togglingId === wf.id ? '…' : wf.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        className="btn sm ghost"
                        style={{ color: 'var(--danger)' }}
                        disabled={wf.poseCount > 0}
                        onClick={() => setDeleting(wf.id)}
                        title={wf.poseCount > 0
                          ? `Cannot delete — ${wf.poseCount} pose${wf.poseCount === 1 ? '' : 's'} use this workflow`
                          : 'Delete workflow'
                        }
                      >
                        <Icon.Trash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload modal */}
      {showUpload && (
        <WorkflowUploadModal
          onCreated={handleCreated}
          onClose={() => setShowUpload(false)}
          toast={toast}
        />
      )}

      {/* Delete confirmation */}
      {deleting && deletingWorkflow && (
        <ConfirmModal
          title="Delete workflow"
          body={`Delete "${deletingWorkflow.label}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => handleDelete(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
