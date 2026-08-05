import { useEffect, useState } from 'react';
import { Icon } from './Icons';
import { SearchableSelect } from './SearchableSelect';

export interface DemoSubcategoryEditData {
  id: string;
  name: string;
  garmentSubcategoryId: string;
}

interface DemoSubcategoryModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, garmentSubcategoryId: string) => void;
  initialData?: DemoSubcategoryEditData;
  category: string;
  garmentTypes: { id: string; label: string }[];
  isSaving?: boolean;
}

export function DemoSubcategoryModal({
  open,
  onClose,
  onSave,
  initialData,
  category,
  garmentTypes,
  isSaving = false,
}: DemoSubcategoryModalProps) {
  const [name, setName] = useState('');
  const [garmentSubcategoryId, setGarmentSubcategoryId] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(initialData?.name ?? '');
    setGarmentSubcategoryId(initialData?.garmentSubcategoryId ?? garmentTypes[0]?.id ?? '');
  }, [open, initialData, garmentTypes]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && garmentSubcategoryId && !isSaving) {
      onSave(name.trim(), garmentSubcategoryId);
    }
  };

  return (
    <div className="modal-overlay" onClick={isSaving ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="modal-head">
            <h3>{initialData ? 'Edit subcategory' : 'Add subcategory'}</h3>
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
              <label>Category</label>
              <input
                className="input"
                value={category}
                disabled
                style={{ textTransform: 'capitalize' }}
              />
            </div>
            <div className="field">
              <label>Name</label>
              <input
                className="input"
                required
                maxLength={160}
                value={name}
                disabled={isSaving}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Summer Collection"
              />
            </div>
            <div className="field">
              <label>Garment type</label>
              <SearchableSelect
                options={garmentTypes}
                value={garmentSubcategoryId}
                disabled={isSaving}
                placeholder="— search garment type —"
                onChange={setGarmentSubcategoryId}
              />
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn ghost" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={isSaving || !name.trim() || !garmentSubcategoryId}
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
