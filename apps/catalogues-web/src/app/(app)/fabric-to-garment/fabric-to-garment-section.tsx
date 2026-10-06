'use client';

import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import { CheckIcon, LightbulbIcon, SparkleIcon, SpinnerIcon } from '@/components/icons';
import { C, grad } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { Tooltip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import type { FabricGarmentTypeOption } from './types';

const CARD_STYLE: React.CSSProperties = {
  borderRadius: 16,
  background: C.card,
  border: `1px solid ${C.border}`,
  boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  padding: 24,
  boxSizing: 'border-box',
};

const GENDER_TABS: { id: 'women' | 'men'; label: string }[] = [
  { id: 'women', label: 'Women' },
  { id: 'men', label: 'Men' },
];

function StepBadge({ n }: { n: number }) {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        background: C.lighter,
        color: C.text,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {n}
    </div>
  );
}

// Two stacked step cards: upload the flat fabric photo, then pick a
// garment-type preset (which supplies the workflow's prompt server-side) and
// Generate. Mirrors the numbered-step wizard layout used elsewhere for
// single-shot generation flows, collapsed into two steps since this page has
// no "existing catalogue image" source option and no per-preset
// duration/quality controls to configure.
export function FabricToGarmentSection({
  previewUrl,
  uploading,
  uploadProgress,
  uploadError,
  onFile,
  onRemove,
  presetId,
  onSelectPreset,
  submitting,
  submitError,
  canSubmit,
  onSubmit,
}: {
  previewUrl: string | null;
  uploading: boolean;
  uploadProgress: number;
  uploadError: string | null;
  onFile: (file: File) => void;
  onRemove: () => void;
  presetId: string | null;
  onSelectPreset: (id: string) => void;
  submitting: boolean;
  submitError: string | null;
  canSubmit: boolean;
  onSubmit: () => void;
}): React.ReactElement {
  const [dragOver, setDragOver] = useState(false);
  const [genderTab, setGenderTab] = useState<'women' | 'men'>('women');
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    data,
    isLoading: presetsLoading,
    isError: presetsError,
    refetch: refetchPresets,
  } = useQuery<{ items: FabricGarmentTypeOption[]; creditsCost: number }>({
    queryKey: ['fabric-garment-types'],
    queryFn: () => api.get('/v1/fabric-garment-types'),
    staleTime: 5 * 60_000,
  });
  const { data: creditsData } = useQuery<{
    balance: number;
    unlimitedPlan?: { status: 'active' | 'expiring_soon' | 'expired' | 'revoked' | 'none' } | null;
  }>({
    queryKey: ['credits'],
    queryFn: () => api.get('/v1/credits'),
  });
  const isUnlimitedPlan =
    creditsData?.unlimitedPlan?.status === 'active' ||
    creditsData?.unlimitedPlan?.status === 'expiring_soon';

  const presets = data?.items ?? [];
  const visiblePresets = presets.filter((p) => p.genderSlug === genderTab);
  const creditsCost = data?.creditsCost;
  const balance = creditsData?.balance;
  const insufficientCredits =
    !isUnlimitedPlan &&
    typeof creditsCost === 'number' &&
    typeof balance === 'number' &&
    balance < creditsCost;

  function browse() {
    if (!uploading) inputRef.current?.click();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Step 1 — Upload */}
      <div style={CARD_STYLE}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <StepBadge n={1} />
            <div>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>
                Upload Product Image
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: C.mid }}>
                Upload a clear image of your product
              </p>
            </div>
          </div>
          <Tooltip tip="Use a flat, well-lit, top-down photo of the fabric with no folds or shadows for the best result.">
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                color: C.pink,
                fontSize: 13,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              Tips <LightbulbIcon size={14} />
            </span>
          </Tooltip>
        </div>

        {previewUrl && !uploading ? (
          <div
            style={{
              position: 'relative',
              borderRadius: 12,
              overflow: 'hidden',
              minHeight: 180,
            }}
          >
            {/* biome-ignore lint/performance/noImgElement: local blob URL preview */}
            <img
              src={previewUrl}
              alt="Selected fabric"
              style={{ width: '100%', height: 220, objectFit: 'cover', display: 'block' }}
            />
            <button
              type="button"
              onClick={onRemove}
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 999,
                border: 'none',
                background: 'rgba(0,0,0,0.55)',
                color: C.white,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <X size={12} />
              Change image
            </button>
          </div>
        ) : (
          // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop surface backing a real <input type=file>; the "Click to browse" text and the input itself remain independently keyboard-accessible
          // biome-ignore lint/a11y/useKeyWithClickEvents: same reasoning — the file input and the "Click to browse" text below are the keyboard-operable controls
          <div
            onClick={browse}
            onDragOver={(event) => {
              event.preventDefault();
              if (!uploading) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              const droppedFile = event.dataTransfer.files?.[0];
              if (droppedFile && !uploading) onFile(droppedFile);
            }}
            style={{
              borderRadius: 12,
              outline: `1px dashed ${dragOver ? C.pink : C.lighter}`,
              outlineOffset: -1,
              minHeight: 220,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: 20,
              boxSizing: 'border-box',
              cursor: uploading ? 'not-allowed' : 'pointer',
              transition: 'outline-color 150ms ease',
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading}
              style={{ display: 'none' }}
              onChange={(event) => {
                const selected = event.target.files?.[0];
                event.target.value = '';
                if (selected) onFile(selected);
              }}
            />
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text, textAlign: 'center' }}>
              Drag and drop an image here
            </span>
            <span style={{ fontSize: 13, color: C.mid, textAlign: 'center' }}>
              or{' '}
              <button
                type="button"
                disabled={uploading}
                onClick={(event) => {
                  event.stopPropagation();
                  browse();
                }}
                style={{
                  color: C.pink,
                  fontWeight: 700,
                  fontSize: 13,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: uploading ? 'not-allowed' : 'pointer',
                }}
              >
                Click to browse
              </button>
            </span>
            <span style={{ fontSize: 11, color: C.light, marginTop: 4 }}>
              Supports: PNG, JPG, WEBP up to 20MB
            </span>
            {uploading && (
              <p style={{ margin: 0, fontSize: 12, color: C.mid }}>Uploading… {uploadProgress}%</p>
            )}
            {uploadError && !uploading && (
              <p style={{ margin: 0, fontSize: 12, color: '#D63B4C' }}>{uploadError}</p>
            )}
          </div>
        )}
      </div>

      {/* Step 2 — Garment type + Generate */}
      <div style={CARD_STYLE}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <StepBadge n={2} />
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>
              Garment Type
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: C.mid }}>
              Pick who it's for, then the garment shape the fabric should be stitched into
            </p>
          </div>
        </div>

        <div
          style={{
            display: 'inline-flex',
            gap: 4,
            padding: 4,
            borderRadius: 999,
            background: C.field,
            border: `1px solid ${C.border}`,
          }}
        >
          {GENDER_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setGenderTab(tab.id)}
              style={{
                padding: '9px 28px',
                borderRadius: 999,
                border: 'none',
                background: genderTab === tab.id ? grad : 'transparent',
                color: genderTab === tab.id ? '#FFFFFF' : C.mid,
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {presetsLoading ? (
          <p style={{ color: C.mid, fontSize: 13, margin: 0 }}>Loading garment types…</p>
        ) : presetsError ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ margin: 0, color: '#D63B4C', fontSize: 13 }}>
              Couldn't load garment types.
            </p>
            <button
              type="button"
              onClick={() => refetchPresets()}
              style={{
                alignSelf: 'flex-start',
                border: `1px solid ${C.border2}`,
                borderRadius: 8,
                background: 'transparent',
                color: C.text,
                padding: '6px 12px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        ) : visiblePresets.length === 0 ? (
          <p style={{ color: C.mid, fontSize: 13, margin: 0 }}>No garment types are available.</p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
              gap: 12,
            }}
          >
            {visiblePresets.map((preset) => {
              const selected = preset.id === presetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelectPreset(preset.id)}
                  style={{
                    position: 'relative',
                    padding: 0,
                    textAlign: 'left',
                    overflow: 'hidden',
                    background: C.card,
                    border: selected ? `2px solid ${C.pink}` : `1px solid ${C.border}`,
                    borderRadius: 10,
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{ position: 'relative', aspectRatio: '3 / 4', background: C.lighter }}
                  >
                    {preset.thumbnailUrl && (
                      // biome-ignore lint/performance/noImgElement: presigned R2 URL
                      <img
                        src={preset.thumbnailUrl}
                        alt={preset.label}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                      />
                    )}
                    {selected && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          background: C.pink,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                        }}
                      >
                        <CheckIcon size={11} color="#FFFFFF" />
                      </div>
                    )}
                  </div>
                  <span
                    style={{
                      display: 'block',
                      padding: '8px 8px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      textAlign: 'center',
                      color: C.text,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {preset.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {submitError && <p style={{ margin: 0, color: '#D63B4C', fontSize: 13 }}>{submitError}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Tooltip
            tip={
              insufficientCredits
                ? `You need ${creditsCost} credits and have ${balance}. Top up to continue.`
                : !canSubmit
                  ? !presetId
                    ? 'Upload a fabric photo and pick a garment type to continue'
                    : 'Upload a fabric photo to continue'
                  : undefined
            }
          >
            <GradBtn
              onClick={onSubmit}
              disabled={!canSubmit || insufficientCredits}
              style={{
                width: '100%',
                padding: '14px 0',
                gap: 8,
                fontSize: 15,
                borderRadius: 10,
                background: canSubmit && !insufficientCredits ? grad : '#d1d1d6',
              }}
            >
              {submitting ? (
                <>
                  <SpinnerIcon size={16} /> Generating…
                </>
              ) : (
                <>
                  <SparkleIcon /> Generate Garment
                </>
              )}
            </GradBtn>
          </Tooltip>
          <span style={{ fontSize: 12, color: insufficientCredits ? '#D63B4C' : C.mid }}>
            {isUnlimitedPlan
              ? 'Unlimited generations — monthly plan'
              : typeof creditsCost === 'number'
                ? insufficientCredits
                  ? `${creditsCost} credits per generation. You have ${balance}. Top up to continue.`
                  : `${creditsCost} credits per generation`
                : 'Loading pricing…'}
          </span>
        </div>
      </div>
    </div>
  );
}
