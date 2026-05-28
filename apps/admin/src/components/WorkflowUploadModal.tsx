import { useState, useRef } from 'react';
import { Icon } from './Icons';
import { apiFetch } from '../lib/data';
import type { WorkflowOption } from '../types';

interface ParsedNode {
  id: string;
  class_type: string;
  title: string;
  category: 'image' | 'prompt' | 'other';
}

interface ParseResult {
  nodes: ParsedNode[];
  defaultPrompts: { facePhase?: string; garmentPhase?: string };
}

interface Props {
  onCreated: (wf: WorkflowOption) => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

function NodeSelect({
  label,
  nodes,
  filter,
  value,
  onChange,
  required,
  disabled,
}: {
  label: string;
  nodes: ParsedNode[];
  filter: ParsedNode['category'] | 'all';
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  const filtered = filter === 'all' ? nodes : nodes.filter((n) => n.category === filter);
  return (
    <div className="field">
      <label>{label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}</label>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">— select node —</option>
        {filtered.map((n) => (
          <option key={n.id} value={n.id}>
            [{n.id}] {n.title} ({n.class_type})
          </option>
        ))}
      </select>
    </div>
  );
}

export function WorkflowUploadModal({ onCreated, onClose, toast }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [parsing, setParsing] = useState(false);

  // Metadata
  const [slug, setSlug] = useState('');
  const [label, setLabel] = useState('');

  // Node mappings
  const [faceNodeId, setFaceNodeId] = useState('');
  const [faceFrontNodeId, setFaceFrontNodeId] = useState('');
  const [poseNodeId, setPoseNodeId] = useState('');
  const [bgNodeId, setBgNodeId] = useState('');
  const [upperNodeIds, setUpperNodeIds] = useState<string[]>(['']);
  const [lowerNodeId, setLowerNodeId] = useState('');
  const [shoeNodeId, setShoeNodeId] = useState('');
  const [sizeNodeId, setSizeNodeId] = useState('');
  const [facePhasePromptNode, setFacePhasePromptNode] = useState('');
  const [garmentPhasePromptNode, setGarmentPhasePromptNode] = useState('');

  // Prompt preview (editable, sent as overrides)
  const [promptFacePhase, setPromptFacePhase] = useState('');
  const [promptGarmentPhase, setPromptGarmentPhase] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setJsonFile(f);
    setParsed(null);
    setError(null);
    // Auto-slug from filename
    if (f) {
      const name = f.name.replace(/\.json$/i, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      setSlug(name);
      setLabel(f.name.replace(/\.json$/i, ''));
    }
  };

  const handleParse = async () => {
    if (!jsonFile) return;
    setParsing(true);
    setError(null);
    try {
      const text = await jsonFile.text();
      let jsonContent: Record<string, unknown>;
      try {
        jsonContent = JSON.parse(text) as Record<string, unknown>;
      } catch {
        setError('Invalid JSON — file could not be parsed');
        return;
      }

      const result = await apiFetch<ParseResult>('/admin/workflows/parse', {
        method: 'POST',
        body: JSON.stringify({ jsonContent }),
      });
      setParsed(result);

      // Pre-fill prompt previews from best-guess defaults
      if (result.defaultPrompts.facePhase) setPromptFacePhase(result.defaultPrompts.facePhase);
      if (result.defaultPrompts.garmentPhase) setPromptGarmentPhase(result.defaultPrompts.garmentPhase);

      // Pre-select first image nodes and prompt nodes
      const imageNodes = result.nodes.filter((n) => n.category === 'image');
      const promptNodes = result.nodes.filter((n) => n.category === 'prompt');
      if (imageNodes[0]) setFaceNodeId(imageNodes[0].id);
      if (imageNodes[1]) setFaceFrontNodeId(imageNodes[1].id);
      if (imageNodes[2]) setPoseNodeId(imageNodes[2].id);
      if (imageNodes[3]) setBgNodeId(imageNodes[3].id);
      if (imageNodes[4]) setUpperNodeIds([imageNodes[4].id]);
      if (promptNodes[0]) setFacePhasePromptNode(promptNodes[0].id);
      if (promptNodes[1]) setGarmentPhasePromptNode(promptNodes[1].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse workflow');
    } finally {
      setParsing(false);
    }
  };

  const handleSubmit = async () => {
    if (!jsonFile || !parsed) return;
    if (!slug.trim() || !label.trim()) { setError('Slug and label are required'); return; }
    if (!faceNodeId || !poseNodeId || !bgNodeId || !facePhasePromptNode || !garmentPhasePromptNode) {
      setError('All required node mappings must be selected');
      return;
    }
    const validUpperIds = upperNodeIds.filter(Boolean);
    if (validUpperIds.length === 0) { setError('At least one upper garment node is required'); return; }

    setSaving(true);
    setError(null);
    try {
      const text = await jsonFile.text();
      const jsonContent = JSON.parse(text) as Record<string, unknown>;

      const created = await apiFetch<WorkflowOption>('/admin/workflows', {
        method: 'POST',
        body: JSON.stringify({
          slug: slug.trim(),
          label: label.trim(),
          jsonContent,
          faceNodeId,
          faceFrontNodeId: faceFrontNodeId || undefined,
          poseNodeId,
          bgNodeId,
          upperNodeIds: validUpperIds,
          lowerNodeId: lowerNodeId || undefined,
          shoeNodeId: shoeNodeId || undefined,
          sizeNodeId: sizeNodeId || undefined,
          facePhasePromptNode,
          garmentPhasePromptNode,
        }),
      });
      toast({ title: `Workflow "${created.label}" created` });
      onCreated(created);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create workflow';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const nodes = parsed?.nodes ?? [];
  const canSubmit = !saving && parsed && slug.trim() && label.trim() &&
    faceNodeId && poseNodeId && bgNodeId && facePhasePromptNode && garmentPhasePromptNode &&
    upperNodeIds.filter(Boolean).length > 0;

  return (
    <div className="modal-overlay" onClick={saving || parsing ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(680px, calc(100vw - 40px))' }}>
        <div className="modal-head">
          <h3>Upload workflow</h3>
          <button className="btn sm ghost" onClick={onClose} disabled={saving || parsing} style={{ marginLeft: 'auto' }}>
            <Icon.Close />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '75vh', overflowY: 'auto' }}>

          {/* Step 1: JSON file */}
          <div className="field">
            <label>ComfyUI workflow JSON <span style={{ color: 'var(--danger)' }}>*</span></label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                disabled={saving}
                onChange={handleFileChange}
                style={{ fontSize: 13, flex: 1 }}
              />
              <button
                className="btn sm primary"
                onClick={handleParse}
                disabled={!jsonFile || parsing || saving}
              >
                {parsing ? 'Parsing…' : 'Parse'}
              </button>
            </div>
            {jsonFile && !parsed && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {jsonFile.name} — click Parse to extract node list
              </span>
            )}
            {parsed && (
              <span style={{ fontSize: 12, color: 'var(--success, #4caf50)' }}>
                ✓ Parsed — {nodes.length} nodes found ({nodes.filter((n) => n.category === 'image').length} image, {nodes.filter((n) => n.category === 'prompt').length} prompt)
              </span>
            )}
          </div>

          {parsed && (
            <>
              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0' }} />

              {/* Step 2: Metadata */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="field">
                  <label>Slug <span style={{ color: 'var(--danger)' }}>*</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>(snake_case)</span>
                  </label>
                  <input
                    className="input"
                    value={slug}
                    disabled={saving}
                    placeholder="e.g. twopiece_v3"
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  />
                </div>
                <div className="field">
                  <label>Label <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input
                    className="input"
                    value={label}
                    disabled={saving}
                    placeholder="e.g. Two-Piece v3"
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </div>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0' }} />

              {/* Step 3: Node mappings */}
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
                <strong>Node mappings</strong> — select which node handles each input.
                Dropdowns show all nodes of the expected type. Node IDs are shown in brackets.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <NodeSelect label="Face side image node" nodes={nodes} filter="image" value={faceNodeId} onChange={setFaceNodeId} required disabled={saving} />
                <NodeSelect label="Face front image node" nodes={nodes} filter="image" value={faceFrontNodeId} onChange={setFaceFrontNodeId} disabled={saving} />
                <NodeSelect label="Pose image node" nodes={nodes} filter="image" value={poseNodeId} onChange={setPoseNodeId} required disabled={saving} />
                <NodeSelect label="Background image node" nodes={nodes} filter="image" value={bgNodeId} onChange={setBgNodeId} required disabled={saving} />
                <NodeSelect label="Lower garment node" nodes={nodes} filter="image" value={lowerNodeId} onChange={setLowerNodeId} disabled={saving} />
                <NodeSelect label="Shoe / Footwear node" nodes={nodes} filter="image" value={shoeNodeId} onChange={setShoeNodeId} disabled={saving} />
                <NodeSelect label="Size node (EmptyLatentImage)" nodes={nodes} filter="all" value={sizeNodeId} onChange={setSizeNodeId} disabled={saving} />
              </div>

              {/* Upper garment nodes (can be multiple) */}
              <div className="field">
                <label>Upper garment node(s) <span style={{ color: 'var(--danger)' }}>*</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>(select all nodes that receive the upper garment)</span>
                </label>
                {upperNodeIds.map((uid, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <select
                      className="select"
                      value={uid}
                      disabled={saving}
                      style={{ flex: 1 }}
                      onChange={(e) => {
                        const next = [...upperNodeIds];
                        next[idx] = e.target.value;
                        setUpperNodeIds(next);
                      }}
                    >
                      <option value="">— select node —</option>
                      {nodes.filter((n) => n.category === 'image').map((n) => (
                        <option key={n.id} value={n.id}>[{n.id}] {n.title} ({n.class_type})</option>
                      ))}
                    </select>
                    {upperNodeIds.length > 1 && (
                      <button
                        className="btn sm ghost"
                        disabled={saving}
                        onClick={() => setUpperNodeIds((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        <Icon.Close />
                      </button>
                    )}
                  </div>
                ))}
                {upperNodeIds.length < 4 && (
                  <button
                    className="btn sm ghost"
                    disabled={saving}
                    onClick={() => setUpperNodeIds((prev) => [...prev, ''])}
                    style={{ marginTop: 4 }}
                  >
                    <Icon.Plus /> Add another upper garment node
                  </button>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <NodeSelect label="Face phase prompt node" nodes={nodes} filter="prompt" value={facePhasePromptNode} onChange={setFacePhasePromptNode} required disabled={saving} />
                <NodeSelect label="Garment phase prompt node" nodes={nodes} filter="prompt" value={garmentPhasePromptNode} onChange={setGarmentPhasePromptNode} required disabled={saving} />
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0' }} />

              {/* Step 4: Default prompt preview */}
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
                <strong>Default prompts</strong> — extracted from the selected prompt nodes.
                These become the default when uploading new poses.
              </p>
              <div className="field">
                <label>Face phase prompt (default)</label>
                <textarea
                  className="input"
                  value={promptFacePhase}
                  disabled
                  rows={3}
                  style={{ fontSize: 11, fontFamily: 'monospace', resize: 'none', opacity: 0.7 }}
                />
              </div>
              <div className="field">
                <label>Garment phase prompt (default)</label>
                <textarea
                  className="input"
                  value={promptGarmentPhase}
                  disabled
                  rows={3}
                  style={{ fontSize: 11, fontFamily: 'monospace', resize: 'none', opacity: 0.7 }}
                />
              </div>
            </>
          )}

          {error && (
            <div style={{ fontSize: 13, color: 'var(--danger)', padding: '8px 12px', background: 'var(--danger-soft)', borderRadius: 6 }}>
              {error}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={saving || parsing}>Cancel</button>
          <button
            className="btn primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            <Icon.Upload />
            {saving ? 'Creating…' : 'Create workflow'}
          </button>
        </div>
      </div>
    </div>
  );
}
