import { useState } from 'react';
import { Icon } from './Icons';
import { apiFetch } from '../lib/data';
import type { ModelBackground } from '../types';

interface Props {
  background: ModelBackground;
  onSaved: (updated: ModelBackground) => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export function EditBackgroundModal({ background, onSaved, onClose, toast }: Props) {
  const [form, setForm] = useState({
    label: background.label,
    sortOrder: background.sortOrder,
    genderSlug: background.genderSlug ?? '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        label: form.label,
        sortOrder: form.sortOrder,
        genderSlug: form.genderSlug || null,
      };
      await apiFetch(`/admin/assets/backgrounds/${background.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const updated: ModelBackground = {
        ...background,
        label: form.label,
        sortOrder: form.sortOrder,
        genderSlug: form.genderSlug || null,
      };
      onSaved(updated);
      toast({ title: `${form.label} updated` });
      onClose();
    } catch {
      toast({ kind: 'error', title: 'Failed to update background' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(400px, calc(100vw - 40px))' }}>
        <div className="modal-head">
          <h3>Edit background</h3>
          <button className="btn sm ghost" onClick={onClose} disabled={saving} style={{ marginLeft: 'auto' }}>
            <Icon.Close />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="field">
            <label>Label</label>
            <input
              className="input"
              value={form.label}
              disabled={saving}
              placeholder="e.g. Studio White"
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>Sort order</label>
            <input
              className="input"
              type="number"
              min={0}
              value={form.sortOrder}
              disabled={saving}
              style={{ width: 100 }}
              onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
            />
          </div>
          <div className="field">
            <label>Gender</label>
            <select
              className="select"
              value={form.genderSlug}
              disabled={saving}
              onChange={(e) => setForm((f) => ({ ...f, genderSlug: e.target.value }))}
            >
              <option value="">All genders</option>
              <option value="men">Men</option>
              <option value="women">Women</option>
              <option value="boys">Boys</option>
              <option value="girls">Girls</option>
            </select>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="btn primary"
            onClick={handleSave}
            disabled={saving || !form.label.trim()}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}