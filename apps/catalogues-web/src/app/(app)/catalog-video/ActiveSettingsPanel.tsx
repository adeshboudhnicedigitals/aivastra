'use client';

import type { PixverseQuality } from '@aivastra/types';
import { Clock, Coins, Download, Hd, RefreshCw } from 'lucide-react';
import { C, grad } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { useCatalogVideos } from '@/hooks/use-catalog-videos';
import { JobThumbnail } from './JobThumbnail';
import type { ImageSource } from './types';

const CARD_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: 360,
  borderRadius: 20,
  background: C.card,
  boxShadow: `inset 0 0 0 1.5px ${C.border2}, 0 4px 15px rgba(0,0,0,0.08)`,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const ROW_ICON_COLOR = '#A17AFD';

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          color: '#B5BCD3',
        }}
      >
        {icon}
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#B5BCD3', textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}

// Right-hand slot alongside ActiveVideoPanel — a read-only recap of what was
// submitted (input image, style, prompt, duration, quality) plus the two
// actions that apply to the job as a whole (Download the finished file,
// start over). Frozen at submit time by the caller (page.tsx), not derived
// from the live SourcePanel/ConfigPanel state, so it keeps showing what this
// job actually used even if the caller resets those to build the next one.
export function ActiveSettingsPanel({
  jobId,
  source,
  presetTitle,
  prompt,
  duration,
  quality,
  creditCost,
  onGenerateAnother,
}: {
  jobId: string;
  source: ImageSource;
  presetTitle: string;
  prompt: string;
  duration: number;
  quality: PixverseQuality;
  creditCost: number;
  onGenerateAnother: () => void;
}): React.ReactElement {
  const { data: items } = useCatalogVideos();
  const item = items?.find((i) => i.id === jobId);
  const videoUrl = item?.videoUrl ?? null;
  const failed = item?.status === 'FAILED';

  return (
    <div style={CARD_STYLE}>
      <div
        style={{
          padding: '18px 20px',
          borderBottom: `1px solid ${C.border}`,
          fontSize: 16,
          fontWeight: 700,
          color: C.text,
        }}
      >
        Input & settings
      </div>

      <div style={{ padding: 20, overflowY: 'auto', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: C.text }}>
              Input image
            </p>
            <div
              style={{
                width: 150,
                aspectRatio: '3 / 4',
                borderRadius: 8,
                overflow: 'hidden',
                background: C.lighter,
                border: `1px solid ${C.border}`,
              }}
            >
              {source.kind === 'existing' ? (
                <JobThumbnail jobId={source.jobId} alt="Input image" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                // biome-ignore lint/performance/noImgElement: local blob URL preview
                <img
                  src={source.previewUrl}
                  alt="Input"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              )}
            </div>
          </div>

          <div>
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: C.text }}>
              Prompt
            </p>
            <p
              style={{
                margin: 0,
                maxHeight: 240,
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                fontFamily: 'var(--font-poppins), Poppins, sans-serif',
                fontWeight: 500,
                fontSize: 16,
                lineHeight: '28px',
                letterSpacing: 0,
                color: '#D8DCF2',
                background: '#151827',
                border: '1px solid #2A2E42',
                borderRadius: 8,
                padding: 10,
              }}
            >
              {prompt}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Row
              icon={
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  height={16}
                  viewBox="0 -960 960 960"
                  width={16}
                  fill={ROW_ICON_COLOR}
                  aria-hidden="true"
                >
                  <title>Style</title>
                  <path d="m159-168-34-14q-31-13-41.5-45t3.5-63l72-156v278Zm160 88q-33 0-56.5-23.5T239-160v-240l106 294q3 7 6 13.5t8 12.5h-40Zm206-4q-32 12-62-3t-42-47L243-622q-12-32 2-62.5t46-41.5l302-110q32-12 62 3t42 47l178 488q12 32-2 62.5T827-194L525-84Zm-57.5-487.5Q479-583 479-600t-11.5-28.5Q456-640 439-640t-28.5 11.5Q399-617 399-600t11.5 28.5Q422-560 439-560t28.5-11.5ZM497-160l302-110-178-490-302 110 178 490ZM319-650l302-110-302 110Z" />
                </svg>
              }
              label="Style"
              value={presetTitle}
            />
            <Row
              icon={<Clock size={16} color={ROW_ICON_COLOR} />}
              label="Duration"
              value={`${duration}s`}
            />
            <Row icon={<Hd size={16} color={ROW_ICON_COLOR} />} label="Quality" value={quality} />
            <Row
              icon={<Coins size={16} color={ROW_ICON_COLOR} />}
              label="Credits used"
              value={String(creditCost)}
            />
          </div>

          {failed && (
            <p style={{ margin: 0, color: '#D63B4C', fontSize: 13 }}>
              Generation failed — credits for this job were refunded automatically.
            </p>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 10,
          padding: '16px 20px',
          borderTop: `1px solid ${C.border}`,
        }}
      >
        <a
          href={videoUrl ?? undefined}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!videoUrl}
          onClick={(e) => {
            if (!videoUrl) e.preventDefault();
          }}
          style={{
            flex: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            height: 38,
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            color: C.onDark,
            background: videoUrl ? grad : C.border2,
            opacity: videoUrl ? 1 : 0.6,
            cursor: videoUrl ? 'pointer' : 'not-allowed',
            textDecoration: 'none',
            pointerEvents: videoUrl ? 'auto' : 'none',
          }}
        >
          <Download size={16} />
          Download video
        </a>
        <div style={{ flex: 1 }}>
          <GradBtn
            onClick={onGenerateAnother}
            style={{ width: '100%', background: C.card, border: `1px solid ${C.border2}` }}
          >
            <RefreshCw size={16} />
            Generate again
          </GradBtn>
        </div>
      </div>
    </div>
  );
}
