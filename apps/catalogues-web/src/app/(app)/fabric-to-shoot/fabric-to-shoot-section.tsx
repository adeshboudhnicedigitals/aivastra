'use client';

import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import { GenderCard } from '@/app/(app)/studio/shared-cards';
import { CheckIcon, LightbulbIcon, SpinnerIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { Tooltip } from '@/components/ui/tooltip';
import type { FabricGarmentTypeOption } from './types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const GENDER_META: Record<'women' | 'men' | 'boys' | 'girls', { label: string; img: string }> = {
  women: { label: 'Women', img: `${BASE}/assets/seg-women.png` },
  men: { label: 'Men', img: `${BASE}/assets/seg-men.png` },
  boys: { label: 'Boys', img: `${BASE}/assets/seg-boy.png` },
  girls: { label: 'Girls', img: `${BASE}/assets/seg-girl.png` },
};

export const CARD_STYLE: React.CSSProperties = {
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

// Byte-for-byte copy of studio/page.tsx's own (unexported, so not directly
// importable) VisualCard — used there for garment-type selection. Reused here
// so the garment-type grid in step 3 below renders at the exact same card
// dimensions as Studio's own "Select Your Garment Type" step.
function VisualCard({
  selected,
  onClick,
  img,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  img: string | null;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="visual-card-wrapper"
      style={{
        cursor: 'pointer',
        textAlign: 'center',
        flexShrink: 0,
        width: '100%',
        background: selected
          ? `linear-gradient(${C.card}, ${C.card}) padding-box, linear-gradient(135deg, #BD2587 0%, #ff5b94 100%) border-box`
          : `linear-gradient(${C.card}, ${C.card}) padding-box, linear-gradient(${C.border}, ${C.border}) border-box`,
        border: '1.5px solid transparent',
        borderRadius: 12,
        padding: 0,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        transition: 'box-shadow 0.2s, transform 0.2s',
        boxShadow: selected ? '0px 2px 10px rgba(189, 37, 135, 0.1)' : 'none',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 10,
          background: C.card,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          overflow: 'hidden',
        }}
      >
        <div
          className="visual-card-image"
          style={{
            width: '100%',
            aspectRatio: 108.8 / 109,
            borderRadius: '10px 10px 0 0',
            overflow: 'hidden',
            position: 'relative',
            background: C.lighter,
            boxSizing: 'border-box',
          }}
        >
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            // biome-ignore lint/performance/noImgElement: small UI thumbnail, Next Image not needed
            <img
              src={img}
              alt={label}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'top center',
              }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                background: C.field,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: C.light,
                fontSize: 11,
              }}
            >
              {label}
            </div>
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
                background: 'linear-gradient(135deg, #BD2587 0%, #ff5b94 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 2,
              }}
            >
              <CheckIcon color="#fff" size={11} />
            </div>
          )}
        </div>
        {label && (
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: C.text,
              padding: '8px 4px 6px',
              width: '100%',
              textAlign: 'center',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
            }}
          >
            {label}
          </div>
        )}
      </div>
    </button>
  );
}

export function StepBadge({ n }: { n: number }) {
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

// Steps 1-3 of the single-page flow: upload the flat fabric photo, then pick
// gender and a garment-type preset (which supplies the workflow's prompt
// server-side) — same two-step shape as Studio's own "Create Catalogue For"
// then "Select Your Garment Type", reusing Studio's exported GenderCard
// directly. No submit button here — the whole page (this plus, once the
// preset is linked to a Studio garment type, the Studio-style steps rendered
// below it) shares ONE submit button at the bottom, same as studio/page.tsx's
// own single stacked wizard.
export function FabricToShootSection({
  previewUrl,
  uploading,
  uploadProgress,
  uploadError,
  onFile,
  onRemove,
  gender,
  onSelectGender,
  availableGenders,
  genderPresets,
  presetsLoading,
  presetsError,
  onRetryPresets,
  presetId,
  onSelectPreset,
}: {
  previewUrl: string | null;
  uploading: boolean;
  uploadProgress: number;
  uploadError: string | null;
  onFile: (file: File) => void;
  onRemove: () => void;
  gender: 'women' | 'men' | 'boys' | 'girls' | null;
  onSelectGender: (gender: 'women' | 'men' | 'boys' | 'girls') => void;
  availableGenders: ('women' | 'men' | 'boys' | 'girls')[];
  genderPresets: FabricGarmentTypeOption[];
  presetsLoading: boolean;
  presetsError: boolean;
  onRetryPresets: () => void;
  presetId: string | null;
  onSelectPreset: (id: string) => void;
}): React.ReactElement {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function browse() {
    if (!uploading) inputRef.current?.click();
  }

  return (
    <>
      {/* Step 1 — Upload */}
      <div style={CARD_STYLE}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <StepBadge n={1} />
            <div>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>
                Upload Fabric Image
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: C.mid }}>
                Upload a clear image of your fabric
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

      {/* Step 2 — Gender, same GenderCard component and the same
          `.gender-card-grid` (4-col, container-query responsive) layout as
          Studio's own "Create Catalogue For" (studio/page.tsx). */}
      <div className="studio-audience-section" style={CARD_STYLE}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <StepBadge n={2} />
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>Create For</h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: C.mid }}>
              Choose your target audience
            </p>
          </div>
        </div>
        {presetsLoading ? (
          <p style={{ color: C.mid, fontSize: 13, margin: 0 }}>Loading…</p>
        ) : availableGenders.length === 0 ? (
          <p style={{ color: C.mid, fontSize: 13, margin: 0 }}>No garment types are available.</p>
        ) : (
          <div className="gender-card-grid">
            {availableGenders.map((g) => (
              <GenderCard
                key={g}
                img={GENDER_META[g].img}
                label={GENDER_META[g].label}
                selected={gender === g}
                onClick={() => onSelectGender(g)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Step 3 — Garment type, same `.studio-5col-grid` + VisualCard as
          Studio's own "Select Your Garment Type" grid (thumbnail + label,
          pink border + check badge when selected). */}
      <div style={CARD_STYLE}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <StepBadge n={3} />
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>
              Select Your Garment Type
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: C.mid }}>
              The garment shape the fabric should be stitched into
            </p>
          </div>
        </div>

        {!gender ? (
          <p style={{ color: C.mid, fontSize: 13, margin: 0 }}>Select a segment first.</p>
        ) : presetsLoading ? (
          <p style={{ color: C.mid, fontSize: 13, margin: 0 }}>
            <SpinnerIcon size={14} /> Loading garment types…
          </p>
        ) : presetsError ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ margin: 0, color: '#D63B4C', fontSize: 13 }}>
              Couldn't load garment types.
            </p>
            <button
              type="button"
              onClick={onRetryPresets}
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
        ) : genderPresets.length === 0 ? (
          <p style={{ color: C.mid, fontSize: 13, margin: 0 }}>No garment types are available.</p>
        ) : (
          <div className="studio-5col-grid">
            {genderPresets.map((preset) => (
              <VisualCard
                key={preset.id}
                selected={preset.id === presetId}
                onClick={() => onSelectPreset(preset.id)}
                img={preset.thumbnailUrl}
                label={preset.label}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
