'use client';
import { SparkleIcon } from '@/components/icons';
import { C } from '@/components/tokens';

const BENEFITS = ['No photoshoots required', 'No model coordination', 'No editing hassle'];

export function PreviewPanel() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 20,
        background: 'rgba(245,245,245,0.4)',
        boxShadow: `inset 0 0 0 1px ${C.border2}, 0 4px 15px rgba(0,0,0,0.08)`,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          height: 88,
          borderBottom: `1px solid ${C.border2}`,
          padding: 16,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: 20, fontWeight: 600, color: C.text }}>Your Catalogue Preview</span>
        <span style={{ fontSize: 14, fontWeight: 500, color: C.mid }}>
          Generated images will appear here.
        </span>
      </div>
      <div style={{ flex: 1, padding: 16, boxSizing: 'border-box' }}>
        <div
          style={{
            height: '100%',
            borderRadius: 8,
            outline: `2px dashed ${C.border2}`,
            outlineOffset: -2,
            padding: 16,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              width: '100%',
              flex: 1,
              minHeight: 200,
              borderRadius: 8,
              background:
                'repeating-linear-gradient(135deg, rgb(245,245,246) 0 14px, rgb(239,239,241) 14px 28px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: C.light }}>
              generated preview
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              width: '100%',
              padding: '16px 8px 0',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  textAlign: 'center',
                  color: C.text,
                }}
              >
                From product photo to catalogue-ready visuals
              </span>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  textAlign: 'center',
                  color: C.mid,
                  maxWidth: 420,
                }}
              >
                Upload your product image, choose your preferences, and let AI create high-quality
                catalogue images that look professionally shot.
              </span>
            </div>
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}
            >
              {BENEFITS.map((b) => (
                <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: C.pink, display: 'flex' }}>
                    <SparkleIcon />
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 500, color: C.text }}>{b}</span>
                </div>
              ))}
            </div>
          </div>
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              fontStyle: 'italic',
              textAlign: 'center',
              color: C.light,
              paddingTop: 16,
            }}
          >
            Preview your AI-generated output here before download.
          </span>
        </div>
      </div>
    </div>
  );
}
