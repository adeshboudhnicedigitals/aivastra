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
  onSaved: (updated: {
    title: string;
    prompt: string;
    sortOrder: number;
    duration: number;
    quality: string;
  }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [prompt, setPrompt] = useState(item.prompt);
  const [sortOrder, setSortOrder] = useState(item.sortOrder);
  const [duration, setDuration] = useState(item.duration);
  const [quality, setQuality] = useState<PixverseQuality>(item.quality as PixverseQuality);
  const [pricing, setPricing] = useState<PixverseVideoPricingConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const canSave = Boolean(title.trim() && prompt.trim());

  useEffect(() => {
    apiFetch<{ pixverseVideoPricing?: PixverseVideoPricingConfig }>('/admin/config')
      .then((cfg) => {
        if (cfg.pixverseVideoPricing) setPricing(cfg.pixverseVideoPricing);
      })
      .catch(() => {
        /* preview is best-effort; save itself doesn't need this */
      });
  }, []);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const patch = {
      title: title.trim(),
      prompt: prompt.trim(),
      sortOrder,
      duration,
      quality,
    };
    try {
      await apiFetch(`/admin/assets/sample-videos/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      toast({ title: 'Sample video updated' });
      onSaved(patch);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to update',
        body: apiErrorMessage(e, 'Please try again.'),
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
      width="min(640px, calc(100vw - 40px))"
      saving={saving}
      onSave={() => void save()}
      saveLabel="Save"
      saveDisabled={!canSave || saving}
    >
      <p className="hint">
        This does not touch the uploaded video — it keeps showing whatever it was generated to show.
        Keep prompt/duration/quality in sync with what the video actually looks like.
      </p>
      <div className="field">
        <label>Title</label>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
        />
      </div>
      <div className="field">
        <label>PixVerse prompt</label>
        <textarea
          className="input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={5000}
          rows={4}
        />
      </div>
      <div className="field">
        <label>Sort order</label>
        <input
          className="input"
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(Number(e.target.value))}
          style={{ width: 100 }}
        />
      </div>
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
