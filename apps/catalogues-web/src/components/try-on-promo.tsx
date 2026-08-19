'use client';

import { Play, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { extractYoutubeId } from '@/lib/youtube';
import { C, grad } from './tokens';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=aivastra.nice.interactive';

const DEMO_VIDEO_URL = 'https://youtu.be/bEfqH2V2FDs';

/** Top-right link to the Android app — shown below the navbar on the Try-On page.
 * Styled like GradBtn (components/ui/grad-btn.tsx), the app's standard primary
 * button, but as an <a> (external link, not an in-page action) and sized up
 * for visibility since this is a promo, not a routine toolbar action. */
export function GetAppButton() {
  return (
    <a
      href={PLAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="btn-hover-opacity"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        height: 48,
        padding: '0 28px',
        boxSizing: 'border-box',
        borderRadius: 10,
        fontFamily: 'inherit',
        fontWeight: 600,
        fontSize: 16,
        whiteSpace: 'nowrap',
        background: grad,
        color: C.white,
        border: 'none',
        textDecoration: 'none',
        boxShadow: '0 6px 18px rgba(245,92,122,0.28)',
        flexShrink: 0,
      }}
    >
      <Smartphone size={20} />
      Download App
    </a>
  );
}

/** Bottom-of-page "how it works" video — click-to-play YouTube embed, same
 * thumbnail/play-button pattern as the Tutorials page. Sized to roughly a
 * quarter of the container width rather than stretching full-width. */
export function DemoVideoSection({ youtubeUrl = DEMO_VIDEO_URL }: { youtubeUrl?: string }) {
  const [playing, setPlaying] = useState(false);
  const videoId = extractYoutubeId(youtubeUrl);
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  return (
    <div
      style={{
        background: C.white,
        borderRadius: 16,
        border: 'none',
        padding: '20px',
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 12,
        boxShadow: '0 8px 30px rgba(0,0,0,0.05)',
        margin: '0 28px 40px',
      }}
    >
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>See how Try On works</div>
        <div style={{ fontSize: 12, color: C.mid, marginTop: 2 }}>
          A quick walkthrough of the steps above
        </div>
      </div>

      {/* biome-ignore lint/a11y/useKeyWithClickEvents: same pattern as the Tutorials page card */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: same pattern as the Tutorials page card */}
      <div
        style={{
          position: 'relative',
          width: 320,
          maxWidth: '100%',
          aspectRatio: '16 / 9',
          borderRadius: 12,
          overflow: 'hidden',
          background: C.bg,
          cursor: playing ? 'default' : 'pointer',
        }}
        onClick={() => {
          if (!playing) setPlaying(true);
        }}
      >
        {playing ? (
          <iframe
            width="100%"
            height="100%"
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
            title="See how Try On works"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            style={{ position: 'absolute', inset: 0 }}
          />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {/* biome-ignore lint/performance/noImgElement: youtube thumbnail */}
            <img
              src={thumbnailUrl}
              alt="See how Try On works"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0,0,0,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: grad,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                }}
              >
                <Play size={20} color="#fff" fill="#fff" />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
