import { useCallback, useEffect, useState } from 'react';
import { ConfirmModal } from '../components/ConfirmModal';
import { Icon } from '../components/Icons';
import { SearchableSelect } from '../components/SearchableSelect';
import { WorkflowUploadModal } from '../components/WorkflowUploadModal';
import { ApiError, apiErrorMessage, apiFetch } from '../lib/data';
import type { WorkflowOption } from '../types';

interface WorkflowDetail extends WorkflowOption {
  faceNodeId: string;
  poseNodeId: string;
  bgNodeId: string;
  upperNodeIds: string[];
  lowerNodeId: string | null;
  shoeNodeId: string | null;
  thirdNodeId: string | null;
  facePhasePromptNode: string;
  garmentPhasePromptNode: string;
  defaultFacePhasePrompt: string;
  defaultGarmentPhasePrompt: string;
  jsonContent: Record<string, unknown>;
  sizeNodeIds: string[];
  latentSizeNodeIds: string[];
  latentMaxPx: number;
  outputSizeNodeIds: string[];
  outputMaxPx: number;
  resultNodeId: string | null;
}

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
}

export default function WorkflowsPage({ toast }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState<WorkflowOption | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState('');
  const [reassignSaving, setReassignSaving] = useState(false);
  const [viewingDetail, setViewingDetail] = useState<WorkflowDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [jsonCopied, setJsonCopied] = useState(false);
  const [editingWf, setEditingWf] = useState<WorkflowOption | null>(null);
  const [editForm, setEditForm] = useState({
    label: '',
    slug: '',
  });
  const [editSaving, setEditSaving] = useState(false);

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<WorkflowOption[]>('/admin/workflows');
      setWorkflows(data);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load workflows',
        body: apiErrorMessage(e, 'Please try again.'),
      });
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
      const msg =
        e instanceof ApiError
          ? ((e.body as { error?: { message?: string } })?.error?.message ??
            'Failed to delete workflow')
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
      setWorkflows((prev) =>
        prev.map((w) => (w.id === wf.id ? { ...w, isActive: !w.isActive } : w)),
      );
      toast({ title: `Workflow "${wf.label}" ${wf.isActive ? 'deactivated' : 'activated'}` });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to update workflow',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setTogglingId(null);
    }
  };

  const handleReassign = async () => {
    if (!reassigning || !reassignTargetId) return;
    setReassignSaving(true);
    try {
      await apiFetch(`/admin/workflows/${reassigning.id}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ targetWorkflowId: reassignTargetId }),
      });
      setWorkflows((prev) =>
        prev.map((w) => {
          if (w.id === reassigning.id) return { ...w, poseCount: 0 };
          if (w.id === reassignTargetId)
            return { ...w, poseCount: w.poseCount + reassigning.poseCount };
          return w;
        }),
      );
      toast({
        title: `Poses reassigned from "${reassigning.label}"`,
      });
      setReassigning(null);
      setReassignTargetId('');
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? ((e.body as { error?: { message?: string } })?.error?.message ?? 'Failed to reassign')
          : 'Failed to reassign';
      toast({ kind: 'error', title: msg });
    } finally {
      setReassignSaving(false);
    }
  };

  const handleViewDetail = async (id: string) => {
    setDetailLoading(true);
    setViewingDetail(null);
    try {
      const detail = await apiFetch<WorkflowDetail>(`/admin/workflows/${id}`);
      setViewingDetail(detail);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load workflow detail',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setDetailLoading(false);
    }
  };

  const handleEditSave = async () => {
    if (!editingWf) return;
    setEditSaving(true);
    try {
      const patch: Record<string, unknown> = {
        label: editForm.label.trim(),
        slug: editForm.slug.trim(),
      };
      await apiFetch(`/admin/workflows/${editingWf.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === editingWf.id
            ? {
                ...w,
                label: editForm.label.trim(),
                slug: editForm.slug.trim(),
              }
            : w,
        ),
      );
      toast({ title: 'Workflow updated' });
      setEditingWf(null);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? ((e.body as { error?: { message?: string } })?.error?.message ?? 'Failed to update')
          : 'Failed to update';
      toast({ kind: 'error', title: msg });
    } finally {
      setEditSaving(false);
    }
  };

  const deletingWorkflow = deleting ? workflows.find((w) => w.id === deleting) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
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
        <div
          style={{ color: 'var(--muted)', fontSize: 13, padding: '32px 0', textAlign: 'center' }}
        >
          Loading…
        </div>
      ) : workflows.length === 0 ? (
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
          <p style={{ marginTop: 12 }}>
            No workflows yet. Upload your first ComfyUI workflow JSON to get started.
          </p>
          <button
            className="btn primary"
            style={{ marginTop: 12 }}
            onClick={() => setShowUpload(true)}
          >
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
                <th>Type</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Created</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((wf) => (
                <tr key={wf.id}>
                  <td style={{ fontWeight: 500 }}>{wf.label}</td>
                  <td>
                    <code
                      style={{
                        fontSize: 12,
                        background: 'var(--bg-2)',
                        padding: '2px 6px',
                        borderRadius: 4,
                      }}
                    >
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
                        background:
                          wf.workflowType === 'tryon'
                            ? 'rgba(236,72,153,0.12)'
                            : wf.workflowType === 'saree_step1'
                              ? 'rgba(217,119,6,0.12)'
                              : wf.workflowType === 'saree_step1_two_input'
                                ? 'rgba(139,92,246,0.12)'
                                : 'rgba(37,99,235,0.1)',
                        color:
                          wf.workflowType === 'tryon'
                            ? '#be185d'
                            : wf.workflowType === 'saree_step1'
                              ? '#b45309'
                              : wf.workflowType === 'saree_step1_two_input'
                                ? '#6d28d9'
                                : '#1d4ed8',
                      }}
                    >
                      {wf.workflowType === 'tryon'
                        ? 'Tryon'
                        : wf.workflowType === 'saree_step1'
                          ? 'Saree Step 1'
                          : wf.workflowType === 'saree_step1_two_input'
                            ? 'Saree Step 1 (2-input)'
                            : 'Catalogue workflows'}
                    </span>
                  </td>
                  <td>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: wf.isActive
                          ? 'var(--success-soft, rgba(76,175,80,0.12))'
                          : 'var(--bg-2)',
                        color: wf.isActive ? 'var(--success, #4caf50)' : 'var(--muted)',
                      }}
                    >
                      {wf.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 12 }}>
                    {new Date(wf.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        className="btn sm ghost"
                        onClick={() => {
                          setEditingWf(wf);
                          setEditForm({
                            label: wf.label,
                            slug: wf.slug,
                          });
                        }}
                        title="Edit workflow"
                      >
                        <Icon.Edit /> Edit
                      </button>
                      <button
                        className="btn sm ghost"
                        disabled={detailLoading}
                        onClick={() => handleViewDetail(wf.id)}
                        title="View parsed data"
                      >
                        <Icon.Eye /> View
                      </button>
                      <button
                        className="btn sm ghost"
                        disabled={togglingId === wf.id}
                        onClick={() => handleToggleActive(wf)}
                        title={wf.isActive ? 'Deactivate' : 'Activate'}
                      >
                        {wf.isActive ? <Icon.Eye /> : <Icon.Eye />}
                        {togglingId === wf.id ? '…' : wf.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      {wf.poseCount > 0 && (
                        <button
                          className="btn sm ghost"
                          disabled={workflows.length <= 1}
                          onClick={() => {
                            setReassigning(wf);
                            setReassignTargetId('');
                          }}
                          title={
                            workflows.length <= 1
                              ? 'No other workflows to reassign to'
                              : 'Reassign poses to another workflow'
                          }
                        >
                          <Icon.Replace /> Reassign
                        </button>
                      )}
                      <button
                        className="btn sm ghost"
                        style={{ color: 'var(--danger)' }}
                        disabled={wf.poseCount > 0}
                        onClick={() => setDeleting(wf.id)}
                        title={
                          wf.poseCount > 0 ? 'Cannot delete — in use by poses' : 'Delete workflow'
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

      {/* Detail modal */}
      {(viewingDetail || detailLoading) && (
        <div
          className="modal-overlay"
          onClick={detailLoading ? undefined : () => setViewingDetail(null)}
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(760px, calc(100vw - 40px))' }}
          >
            <div className="modal-head">
              <h3>{viewingDetail ? viewingDetail.label : 'Loading…'}</h3>
              <button
                className="btn sm ghost"
                onClick={() => setViewingDetail(null)}
                disabled={detailLoading}
                style={{ marginLeft: 'auto' }}
              >
                <Icon.Close />
              </button>
            </div>
            {detailLoading ? (
              <div
                className="modal-body"
                style={{ textAlign: 'center', color: 'var(--muted)', padding: '32px 0' }}
              >
                Loading…
              </div>
            ) : viewingDetail ? (
              <div
                className="modal-body"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 20,
                  maxHeight: '75vh',
                  overflowY: 'auto',
                }}
              >
                {/* Node mappings */}
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: 'var(--muted)',
                      marginBottom: 10,
                    }}
                  >
                    Node mappings
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '180px 1fr',
                      gap: '6px 12px',
                      fontSize: 13,
                    }}
                  >
                    {(viewingDetail.workflowType === 'tryon' ||
                    viewingDetail.workflowType === 'saree_step1' ||
                    viewingDetail.workflowType === 'saree_step1_two_input'
                      ? [
                          ['Person node', viewingDetail.tryonPersonNodeId ?? '—'],
                          [
                            viewingDetail.workflowType === 'saree_step1_two_input'
                              ? 'Body node'
                              : 'Garment node',
                            viewingDetail.tryonGarmentNodeId ?? '—',
                          ],
                          ...(viewingDetail.workflowType === 'saree_step1_two_input'
                            ? [['Pallu node', viewingDetail.tryonGarmentNodeId2 ?? '—']]
                            : []),
                          ['Output node', viewingDetail.tryonOutputNodeId ?? '—'],
                        ]
                      : [
                          ['Face node', viewingDetail.faceNodeId],
                          ['Pose node', viewingDetail.poseNodeId],
                          ['Background node', viewingDetail.bgNodeId],
                          ['Upper nodes', viewingDetail.upperNodeIds.join(', ')],
                          ['Lower node', viewingDetail.lowerNodeId ?? '—'],
                          ['Shoe node', viewingDetail.shoeNodeId ?? '—'],
                          ['Third node', viewingDetail.thirdNodeId ?? '—'],
                          [
                            'Size nodes',
                            viewingDetail.sizeNodeIds.length > 0
                              ? viewingDetail.sizeNodeIds.join(', ')
                              : '—',
                          ],
                          [
                            'Latent size nodes',
                            viewingDetail.latentSizeNodeIds.length > 0
                              ? `${viewingDetail.latentSizeNodeIds.join(', ')} (max ${viewingDetail.latentMaxPx}px)`
                              : '—',
                          ],
                          [
                            'Output size nodes',
                            viewingDetail.outputSizeNodeIds.length > 0
                              ? `${viewingDetail.outputSizeNodeIds.join(', ')} (max ${viewingDetail.outputMaxPx}px)`
                              : '—',
                          ],
                          ['Result node', viewingDetail.resultNodeId ?? '—'],
                          ['Negative prompt node', viewingDetail.facePhasePromptNode],
                          ['Positive prompt node', viewingDetail.garmentPhasePromptNode],
                        ]
                    ).map(([k, v]) => (
                      <>
                        <span key={`k-${k}`} style={{ color: 'var(--muted)', fontWeight: 500 }}>
                          {k}
                        </span>
                        <code
                          key={`v-${k}`}
                          style={{
                            fontSize: 12,
                            background: 'var(--subtle)',
                            padding: '2px 6px',
                            borderRadius: 4,
                            wordBreak: 'break-all',
                          }}
                        >
                          {v}
                        </code>
                      </>
                    ))}
                  </div>
                </div>

                {/* Default prompts */}
                {(viewingDetail.defaultFacePhasePrompt ||
                  viewingDetail.defaultGarmentPhasePrompt) && (
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: 'var(--muted)',
                        marginBottom: 10,
                      }}
                    >
                      Default prompts
                    </div>
                    {viewingDetail.defaultFacePhasePrompt && (
                      <div style={{ marginBottom: 10 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: 'var(--ink-2)',
                            marginBottom: 4,
                          }}
                        >
                          Negative prompt
                        </div>
                        <pre
                          style={{
                            margin: 0,
                            fontSize: 11.5,
                            background: 'var(--subtle)',
                            padding: '10px 12px',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                            overflowX: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {viewingDetail.defaultFacePhasePrompt}
                        </pre>
                      </div>
                    )}
                    {viewingDetail.defaultGarmentPhasePrompt && (
                      <div>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: 'var(--ink-2)',
                            marginBottom: 4,
                          }}
                        >
                          Positive prompt
                        </div>
                        <pre
                          style={{
                            margin: 0,
                            fontSize: 11.5,
                            background: 'var(--subtle)',
                            padding: '10px 12px',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                            overflowX: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {viewingDetail.defaultGarmentPhasePrompt}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                {/* Raw JSON */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: 'var(--muted)',
                      }}
                    >
                      Workflow JSON ({Object.keys(viewingDetail.jsonContent).length} nodes)
                    </div>
                    <button
                      className="btn sm ghost"
                      style={{ fontSize: 11 }}
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          JSON.stringify(viewingDetail.jsonContent, null, 2),
                        );
                        setJsonCopied(true);
                        setTimeout(() => setJsonCopied(false), 1500);
                      }}
                    >
                      {jsonCopied ? '✓ Copied' : 'Copy JSON'}
                    </button>
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      fontSize: 11,
                      background: 'var(--subtle)',
                      padding: '12px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      maxHeight: 300,
                      overflowY: 'auto',
                      overflowX: 'auto',
                      whiteSpace: 'pre',
                      fontFamily: 'var(--mono, monospace)',
                    }}
                  >
                    {JSON.stringify(viewingDetail.jsonContent, null, 2)}
                  </pre>
                </div>
              </div>
            ) : null}
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setViewingDetail(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit label/slug modal */}
      {editingWf && (
        <div className="modal-overlay" onClick={editSaving ? undefined : () => setEditingWf(null)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(420px, calc(100vw - 40px))' }}
          >
            <div className="modal-head">
              <h3>Edit workflow</h3>
              <button
                className="btn sm ghost"
                onClick={() => setEditingWf(null)}
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
                <label>Label</label>
                <input
                  className="input"
                  value={editForm.label}
                  disabled={editSaving}
                  onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Slug</label>
                <input
                  className="input"
                  value={editForm.slug}
                  disabled={editSaving}
                  placeholder="snake_case"
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                    }))
                  }
                />
              </div>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => setEditingWf(null)}
                disabled={editSaving}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={editSaving || !editForm.label.trim() || !editForm.slug.trim()}
                onClick={handleEditSave}
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
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

      {/* Reassign modal */}
      {reassigning && (
        <div
          className="modal-overlay"
          onClick={
            reassignSaving
              ? undefined
              : () => {
                  setReassigning(null);
                  setReassignTargetId('');
                }
          }
        >
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 380 }}>
            <div className="modal-head">
              <h3>Reassign workflow</h3>
              <button
                className="btn sm ghost"
                onClick={
                  reassignSaving
                    ? undefined
                    : () => {
                        setReassigning(null);
                        setReassignTargetId('');
                      }
                }
                style={{ marginLeft: 'auto' }}
              >
                <Icon.Close />
              </button>
            </div>
            <div
              className="modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <p style={{ margin: 0 }}>
                Poses use <strong>{reassigning.label}</strong>. Choose a target workflow to move
                them to.
              </p>
              <div className="field">
                <label>Target workflow</label>
                <SearchableSelect
                  options={workflows
                    .filter((w) => w.id !== reassigning.id)
                    .map((w) => ({ id: w.id, label: `${w.label} (${w.slug})` }))}
                  value={reassignTargetId}
                  disabled={reassignSaving}
                  onChange={setReassignTargetId}
                  placeholder="— search workflow —"
                  emptyLabel="— Select —"
                />
              </div>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={
                  reassignSaving
                    ? undefined
                    : () => {
                        setReassigning(null);
                        setReassignTargetId('');
                      }
                }
              >
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={reassignSaving || !reassignTargetId}
                onClick={handleReassign}
              >
                {reassignSaving ? 'Reassigning…' : 'Reassign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
