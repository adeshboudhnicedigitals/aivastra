import {
  computePixverseVideoCost,
  PIXVERSE_DURATION_MAX,
  PIXVERSE_DURATION_MIN,
  PIXVERSE_QUALITIES,
  type PixverseQuality,
  type PixverseVideoPricingConfig,
} from '@aivastra/types';
import { useEffect, useState } from 'react';
import { apiErrorMessage, apiFetch } from '../lib/data';
import { EditDrawer } from './EditDrawer';
import type { SampleVideo } from './SampleVideoUploadModal';

export function SampleVideoEditDrawer({
  item,
  onClose,
  onSaved,
  toast,
}: {
  item: SampleVideo;
  onClose: () => void;
  onSaved: (updated: { duration: number; quality: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}) {
  const [duration, setDuration] = useState(item.duration);
  const [quality, setQuality] = useState<PixverseQuality>(item.quality as PixverseQuality);
  const [pricing, setPricing] = useState<PixverseVideoPricingConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ pixverseVideoPricing?: PixverseVideoPricingConfig }>('/admin/config')
      .then((cfg) => {
        if (cfg.pixverseVideoPricing) setPricing(cfg.pixverseVideoPricing);
      })
      .catch(() => {
        /* preview is best-effort; save doesn't depend on it */
      });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(`/admin/assets/sample-videos/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ duration, quality }),
      });
      toast({ title: 'Sample video updated' });
      onSaved({ duration, quality });
    } catch (error) {
      toast({
        kind: 'error',
        title: 'Failed to update sample video',
        body: apiErrorMessage(error, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditDrawer
      onClose={onClose}
      title="Edit sample video"
      subtitle={item.title}
      width="min(480px, calc(100vw - 40px))"
      saving={saving}
      onSave={() => void save()}
      saveLabel="Save"
    >
      <div className="field">
        <label>Duration (seconds)</label>
        <input
          className="input"
          type="number"
          min={PIXVERSE_DURATION_MIN}
          max={PIXVERSE_DURATION_MAX}
          value={duration}
          onChange={(e) =>
            setDuration(
              Math.min(
                PIXVERSE_DURATION_MAX,
                Math.max(PIXVERSE_DURATION_MIN, Number(e.target.value)),
              ),
            )
          }
          style={{ width: 100 }}
        />
      </div>
      <div className="field">
        <label>Quality</label>
        <select
          className="input"
          value={quality}
          onChange={(e) => setQuality(e.target.value as PixverseQuality)}
        >
          {PIXVERSE_QUALITIES.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
      </div>
      {pricing && (
        <p className="hint">
          Estimated cost: {computePixverseVideoCost(duration, quality, pricing)} credits
        </p>
      )}
    </EditDrawer>
  );
}
