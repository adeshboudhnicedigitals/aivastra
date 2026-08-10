import { useEffect, useState } from 'react';
import { Icon } from './Icons';

export interface DemoSetEditData {
  id: string;
  name: string;
  description: string | null;
}

interface DemoSetModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, description: string) => void;
  initialData?: DemoSetEditData;
  isSaving?: boolean;
}

export function DemoSetModal({
  open,
  onClose,
  onSave,
  initialData,
  isSaving = false,
}: DemoSetModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(initialData?.name ?? '');
    setDescription(initialData?.description ?? '');
  }, [open, initialData]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && !isSaving) onSave(name.trim(), description.trim());
  };

  return (
    <div className="modal-overlay" onClick={isSaving ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="modal-head">
            <h3>{initialData ? 'Edit demo set' : 'Add demo set'}</h3>
            <button
              type="button"
              className="btn sm ghost"
              onClick={onClose}
              disabled={isSaving}
              style={{ marginLeft: 'auto' }}
            >
              <Icon.Close />
            </button>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label>Name</label>
              <input
                className="input"
                required
                maxLength={160}
                value={name}
                disabled={isSaving}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Summer Demo Set"
              />
            </div>
            <div className="field">
              <label>Description</label>
              <textarea
                className="input"
                maxLength={500}
                value={description}
                disabled={isSaving}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn ghost" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={isSaving || !name.trim()}>
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
