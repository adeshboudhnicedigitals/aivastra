'use client';

import { SparkleIcon, SpinnerIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { Tooltip } from '@/components/ui/tooltip';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// The single submit action for the whole page — shared by the Studio-style
// flow (apps/catalogues-web/src/app/(app)/fabric-to-shoot/
// fabric-to-shoot-studio-flow.tsx) and the fallback card shown for a
// preset that isn't linked to a Studio garment type yet
// (fabric-to-shoot-page's own inline fallback). One click runs the whole
// pipeline — fabric-to-garment generation (backend job/route names are
// unchanged by this page's rename), then (if applicable) the tryon
// job — so there is exactly one button and one credits line on the page.
//
// Rendered by page.tsx as a sibling AFTER the scrollable step list (not
// nested inside it), inside the `.f2s-generate-card` pinned footer — same
// "pinned, left column only" placement and look as Studio's own
// `.studio-generate-card` (credit icon + balance on the left, button + ETA
// on the right), so it stays visible while the steps above it scroll.
export function FabricToShootSubmitFooter({
  label,
  creditsCost,
  balance,
  isUnlimitedPlan,
  canSubmit,
  submitting,
  submitError,
  blockReason,
  onSubmit,
}: {
  label: string;
  creditsCost: number | undefined;
  balance: number | undefined;
  isUnlimitedPlan: boolean;
  canSubmit: boolean;
  submitting: boolean;
  submitError: string | null;
  blockReason: string | undefined;
  onSubmit: () => void;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {submitError && (
        <div
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: `1px solid ${C.pink}`,
            background: 'rgba(245,92,122,0.06)',
            fontSize: 13,
            color: C.pink,
          }}
        >
          {submitError}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              border: '1.5px solid rgba(189, 37, 135, 0.15)',
              background: 'rgba(189, 37, 135, 0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {/* biome-ignore lint/performance/noImgElement: credit icon */}
            <img src={`${BASE}/assets/credit.png`} alt="" width={20} height={20} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
              {isUnlimitedPlan
                ? 'Monthly plan'
                : typeof creditsCost === 'number'
                  ? `From ${creditsCost} credits required`
                  : 'Loading pricing…'}
            </span>
            <span style={{ fontSize: 12, color: C.mid }}>
              {isUnlimitedPlan
                ? 'Unlimited generations'
                : typeof balance === 'number'
                  ? `You have ${balance} credits — more may be used for the photoshoot step`
                  : ' '}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <Tooltip tip={canSubmit ? undefined : blockReason}>
            <GradBtn
              onClick={onSubmit}
              disabled={!canSubmit}
              style={{
                padding: '12px 32px',
                gap: 8,
                fontSize: 15,
                borderRadius: 8,
                background: canSubmit
                  ? 'linear-gradient(135deg, #7c3aed 0%, #BD2587 100%)'
                  : '#d1d1d6',
                boxShadow: canSubmit ? '0 4px 12px rgba(124, 58, 237, 0.2)' : 'none',
              }}
            >
              {submitting ? (
                <>
                  <SpinnerIcon size={16} /> Generating…
                </>
              ) : (
                <>
                  <SparkleIcon /> {label}
                </>
              )}
            </GradBtn>
          </Tooltip>
          <span style={{ fontSize: 11, color: C.light }}>Estimated Time:- 25 seconds</span>
        </div>
      </div>
    </div>
  );
}
