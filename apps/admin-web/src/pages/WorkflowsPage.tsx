import { useCallback, useEffect, useState } from 'react';
import { ConfirmModal } from '../components/ConfirmModal';
import { EditDrawer } from '../components/EditDrawer';
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

function ksamplerOverridesFromWf(wf: WorkflowOption) {
  return wf.ksamplerNodes.map((n) => ({
    nodeId: n.nodeId,
    steps: String(n.steps ?? ''),
    cfg: String(n.cfg ?? ''),
    denoise: String(n.denoise ?? ''),
    seed: String(n.seed ?? ''),
  }));
}

export default function WorkflowsPage({ toast }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [expandedWorkflowId, setExpandedWorkflowId] = useState<string | null>(null);
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
    garmentPhasePrompt: '',
    facePhasePrompt: '',
    stage1PositivePrompt: '',
    stage1NegativePrompt: '',
    ksamplerOverrides: [] as {
      nodeId: string;
      steps: string;
      cfg: string;
      denoise: string;
      seed: string;
    }[],
  });
  const [editSaving, setEditSaving] = useState(false);

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<WorkflowOption[]>('/admin/workflows');
      setWorkflows(data);
    } catch (_e) {
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  const handleCreated = (wf: WorkflowOption) => {
    setWorkflows((prev) => [wf, ...prev]);
    setShowUpload(false);
  };

  const handleDelete = async (id: string) => {
    setDeleting(null);
    if (id.startsWith('wf_demo_')) {
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
      toast({ title: 'Workflow deleted' });
      return;
    }
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
        garmentPhasePrompt: editForm.garmentPhasePrompt.trim(),
      };
      if (editingWf.facePhasePromptNode) {
        patch.facePhasePrompt = editForm.facePhasePrompt.trim();
      }
      if (editingWf.stage1PositivePromptNode) {
        patch.stage1PositivePrompt = editForm.stage1PositivePrompt.trim();
      }
      if (editingWf.stage1NegativePromptNode) {
        patch.stage1NegativePrompt = editForm.stage1NegativePrompt.trim();
      }
      const ksamplerOverrides = editForm.ksamplerOverrides
        .map((o) => {
          const steps = Number(o.steps);
          const cfg = Number(o.cfg);
          const denoise = Number(o.denoise);
          const seed = Number(o.seed);
          const override: {
            nodeId: string;
            steps?: number;
            cfg?: number;
            denoise?: number;
            seed?: number;
          } = { nodeId: o.nodeId };
          if (!Number.isNaN(steps)) override.steps = steps;
          if (!Number.isNaN(cfg)) override.cfg = cfg;
          if (!Number.isNaN(denoise)) override.denoise = denoise;
          if (!Number.isNaN(seed)) override.seed = seed;
          return override;
        })
        .filter((o) => Object.keys(o).length > 1);
      if (ksamplerOverrides.length > 0) patch.ksamplerOverrides = ksamplerOverrides;

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
                defaultGarmentPhasePrompt: editForm.garmentPhasePrompt.trim(),
                ...(editingWf.facePhasePromptNode
                  ? { defaultFacePhasePrompt: editForm.facePhasePrompt.trim() }
                  : {}),
                ...(editingWf.stage1PositivePromptNode
                  ? { defaultStage1PositivePrompt: editForm.stage1PositivePrompt.trim() }
                  : {}),
                ...(editingWf.stage1NegativePromptNode
                  ? { defaultStage1NegativePrompt: editForm.stage1NegativePrompt.trim() }
                  : {}),
                ksamplerNodes: w.ksamplerNodes.map((n) => {
                  const form = editForm.ksamplerOverrides.find((o) => o.nodeId === n.nodeId);
                  if (!form) return n;
                  return {
                    nodeId: n.nodeId,
                    steps: Number.isNaN(Number(form.steps)) ? n.steps : Number(form.steps),
                    cfg: Number.isNaN(Number(form.cfg)) ? n.cfg : Number(form.cfg),
                    denoise: Number.isNaN(Number(form.denoise)) ? n.denoise : Number(form.denoise),
                    seed: Number.isNaN(Number(form.seed)) ? n.seed : Number(form.seed),
                  };
                }),
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

  const q = query.trim().toLowerCase();
  const filteredWorkflows = workflows
    .filter((w) => !q || w.label.toLowerCase().includes(q) || w.slug.toLowerCase().includes(q))
    .filter((w) => !typeFilter || w.workflowType === typeFilter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div className="page-head">
        <div>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>Workflows</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            ComfyUI workflow templates used for try-on generation. Each pose selects one workflow.
          </p>
        </div>
        <div className="head-tools">
          {workflows.length > 0 && (
            <>
              <div className="search">
                <Icon.Search />
                <input
                  placeholder="Search workflows…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  fontSize: 13,
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <option value="">All Types</option>
                <option value="regular">Catalogue workflows</option>
                <option value="tryon">Tryon</option>
                <option value="saree_step1">Saree Step 1</option>
                <option value="saree_step1_two_input">Saree Step 1 (2-input)</option>
              </select>
            </>
          )}
          <button className="btn primary" onClick={() => setShowUpload(true)}>
            <Icon.Plus />
            Add workflow
          </button>
        </div>
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
      ) : filteredWorkflows.length === 0 ? (
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
          {query ? (
            <>No workflows match &ldquo;{query}&rdquo;.</>
          ) : (
            'No workflows match the selected type.'
          )}
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="desktop-only">
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
                  {filteredWorkflows.map((wf) => (
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
                                garmentPhasePrompt: wf.defaultGarmentPhasePrompt,
                                facePhasePrompt: wf.defaultFacePhasePrompt,
                                stage1PositivePrompt: wf.defaultStage1PositivePrompt,
                                stage1NegativePrompt: wf.defaultStage1NegativePrompt,
                                ksamplerOverrides: ksamplerOverridesFromWf(wf),
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
                              wf.poseCount > 0
                                ? 'Cannot delete — in use by poses'
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
          </div>

          {/* Mobile / Tablet Card Accordion List */}
          <div className="mobile-only">
            {filteredWorkflows.map((wf) => {
              const isExpanded = expandedWorkflowId === wf.id;
              return (
                <div
                  key={wf.id}
                  className="card"
                  style={{
                    padding: 0,
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--surface)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedWorkflowId(isExpanded ? null : wf.id)}
                    style={{
                      padding: '14px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      userSelect: 'none',
                      background: 'none',
                      border: 'none',
                      width: '100%',
                      textAlign: 'left',
                      color: 'inherit',
                      fontFamily: 'inherit',
                      fontSize: 'inherit',
                    }}
                  >
                    <span
                      className="semi"
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 15,
                        color: 'var(--ink)',
                        fontWeight: 600,
                      }}
                    >
                      {wf.label}
                    </span>
                    <span
                      style={{
                        color: 'var(--muted-2)',
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s',
                        display: 'inline-flex',
                        marginLeft: 8,
                      }}
                    >
                      <Icon.Chevron />
                    </span>
                  </button>

                  {isExpanded && (
                    <div
                      style={{
                        padding: '16px',
                        borderTop: '1px solid var(--border)',
                        background: 'var(--surface-2)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                        fontSize: 13,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ color: 'var(--muted)', fontWeight: 500 }}>Slug</span>
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
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ color: 'var(--muted)', fontWeight: 500 }}>Type</span>
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
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ color: 'var(--muted)', fontWeight: 500 }}>Status</span>
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
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ color: 'var(--muted)', fontWeight: 500 }}>Created</span>
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                          {new Date(wf.createdAt).toLocaleDateString()}
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          justifyContent: 'flex-end',
                          gap: 8,
                          marginTop: 6,
                          borderTop: '1px solid var(--border)',
                          paddingTop: 10,
                        }}
                      >
                        <button
                          className="btn sm ghost"
                          onClick={() => {
                            setEditingWf(wf);
                            setEditForm({
                              label: wf.label,
                              slug: wf.slug,
                              garmentPhasePrompt: wf.defaultGarmentPhasePrompt,
                              facePhasePrompt: wf.defaultFacePhasePrompt,
                              stage1PositivePrompt: wf.defaultStage1PositivePrompt,
                              stage1NegativePrompt: wf.defaultStage1NegativePrompt,
                              ksamplerOverrides: ksamplerOverridesFromWf(wf),
                            });
                          }}
                        >
                          <Icon.Edit /> Edit
                        </button>
                        <button
                          className="btn sm ghost"
                          disabled={detailLoading}
                          onClick={() => handleViewDetail(wf.id)}
                        >
                          <Icon.Eye /> View
                        </button>
                        <button
                          className="btn sm ghost"
                          disabled={togglingId === wf.id}
                          onClick={() => handleToggleActive(wf)}
                        >
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
                          >
                            <Icon.Replace /> Reassign
                          </button>
                        )}
                        <button
                          className="btn sm ghost danger"
                          disabled={wf.poseCount > 0}
                          onClick={() => setDeleting(wf.id)}
                        >
                          <Icon.Trash /> Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
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
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn sm ghost"
                        style={{ fontSize: 11 }}
                        onClick={() => {
                          const blob = new Blob(
                            [JSON.stringify(viewingDetail.jsonContent, null, 2)],
                            { type: 'application/json' },
                          );
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${viewingDetail.slug || viewingDetail.id}.json`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        Download JSON
                      </button>
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
        <EditDrawer
          onClose={() => setEditingWf(null)}
          title="Edit workflow"
          width="min(640px, calc(100vw - 40px))"
          saving={editSaving}
          onSave={handleEditSave}
          saveLabel="Save"
          saveDisabled={
            !editForm.label.trim() ||
            !editForm.slug.trim() ||
            !editForm.garmentPhasePrompt.trim() ||
            (!!editingWf?.stage1PositivePromptNode && !editForm.stage1PositivePrompt.trim()) ||
            editForm.ksamplerOverrides.some(
              (o) =>
                Number.isNaN(Number(o.steps)) ||
                Number(o.steps) < 1 ||
                Number.isNaN(Number(o.cfg)) ||
                Number(o.cfg) < 0 ||
                Number.isNaN(Number(o.denoise)) ||
                Number(o.denoise) < 0 ||
                Number(o.denoise) > 1 ||
                Number.isNaN(Number(o.seed)) ||
                Number(o.seed) < 0,
            )
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
            <div className="field">
              <label>Garment-phase prompt</label>
              <textarea
                className="input"
                rows={4}
                value={editForm.garmentPhasePrompt}
                disabled={editSaving}
                onChange={(e) => setEditForm((f) => ({ ...f, garmentPhasePrompt: e.target.value }))}
              />
            </div>
            {editingWf?.facePhasePromptNode && (
              <div className="field">
                <label>Face-phase (negative) prompt</label>
                <textarea
                  className="input"
                  rows={4}
                  value={editForm.facePhasePrompt}
                  disabled={editSaving}
                  onChange={(e) => setEditForm((f) => ({ ...f, facePhasePrompt: e.target.value }))}
                />
              </div>
            )}
            {editingWf?.stage1PositivePromptNode && (
              <div className="field">
                <label>Stage 1 positive prompt (build-person pass)</label>
                <textarea
                  className="input"
                  rows={4}
                  value={editForm.stage1PositivePrompt}
                  disabled={editSaving}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, stage1PositivePrompt: e.target.value }))
                  }
                />
              </div>
            )}
            {editingWf?.stage1NegativePromptNode && (
              <div className="field">
                <label>Stage 1 negative prompt (build-person pass)</label>
                <textarea
                  className="input"
                  rows={4}
                  value={editForm.stage1NegativePrompt}
                  disabled={editSaving}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, stage1NegativePrompt: e.target.value }))
                  }
                />
              </div>
            )}
            {editForm.ksamplerOverrides.map((o, idx) => (
              <div key={o.nodeId} className="field" style={{ margin: 0 }}>
                <label style={{ fontSize: 12, fontWeight: 600 }}>
                  KSampler {editForm.ksamplerOverrides.length > 1 ? `— node ${o.nodeId}` : ''}
                </label>
                <div style={{ display: 'flex', gap: 14 }}>
                  <div className="field" style={{ flex: 1, margin: 0 }}>
                    <label>Steps</label>
                    <input
                      className="input"
                      type="number"
                      value={o.steps}
                      disabled={editSaving}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          ksamplerOverrides: f.ksamplerOverrides.map((x, i) =>
                            i === idx ? { ...x, steps: e.target.value } : x,
                          ),
                        }))
                      }
                    />
                  </div>
                  <div className="field" style={{ flex: 1, margin: 0 }}>
                    <label>CFG</label>
                    <input
                      className="input"
                      type="number"
                      value={o.cfg}
                      disabled={editSaving}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          ksamplerOverrides: f.ksamplerOverrides.map((x, i) =>
                            i === idx ? { ...x, cfg: e.target.value } : x,
                          ),
                        }))
                      }
                    />
                  </div>
                  <div className="field" style={{ flex: 1, margin: 0 }}>
                    <label>Denoise</label>
                    <input
                      className="input"
                      type="number"
                      value={o.denoise}
                      disabled={editSaving}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          ksamplerOverrides: f.ksamplerOverrides.map((x, i) =>
                            i === idx ? { ...x, denoise: e.target.value } : x,
                          ),
                        }))
                      }
                    />
                  </div>
                  <div className="field" style={{ flex: 1, margin: 0 }}>
                    <label>Seed</label>
                    <input
                      className="input"
                      type="number"
                      value={o.seed}
                      disabled={editSaving}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          ksamplerOverrides: f.ksamplerOverrides.map((x, i) =>
                            i === idx ? { ...x, seed: e.target.value } : x,
                          ),
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </EditDrawer>
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
        <EditDrawer
          onClose={() => {
            setReassigning(null);
            setReassignTargetId('');
          }}
          title="Reassign workflow"
          width="380px"
          saving={reassignSaving}
          onSave={handleReassign}
          saveLabel="Reassign"
          saveDisabled={!reassignTargetId}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0 }}>
              Poses use <strong>{reassigning.label}</strong>. Choose a target workflow to move them
              to.
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
        </EditDrawer>
      )}
    </div>
  );
}
