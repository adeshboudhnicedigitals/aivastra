'use client';
import Link from 'next/link';
import { use } from 'react';
import { ArrowLeft, DownloadIcon, SparkleIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { DarkBtn } from '@/components/ui/dark-btn';
import { GradBtn } from '@/components/ui/grad-btn';

// TODO(wire): no asset detail endpoint yet — static shell.
const FILE_DETAILS: [string, string][] = [
  ['Filename', 'blue_kurta_flatlay.jpg'],
  ['Type', 'Top Wear'],
  ['File Size', '2.4 MB'],
  ['Resolution', '2400 × 3200 px'],
  ['Format', 'JPEG'],
  ['Uploaded', 'May 25, 2026'],
];

export default function ViewAssetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.ReactElement {
  use(params);
  return (
    <>
      <TopBar
        lead={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link href="/assets" style={{ color: C.mid, display: 'flex', textDecoration: 'none' }}>
              <ArrowLeft />
            </Link>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18, color: C.text }}>
                blue_kurta_flatlay.jpg
              </div>
              <div style={{ fontSize: 12, color: C.mid }}>Uploaded May 25, 2026 · 2.4 MB</div>
            </div>
          </div>
        }
        right={
          <div style={{ display: 'flex', gap: 10 }}>
            <Link href="/studio" style={{ textDecoration: 'none' }}>
              <GradBtn style={{ gap: 6, fontSize: 13 }}>
                <SparkleIcon /> Use in Studio
              </GradBtn>
            </Link>
            <DarkBtn style={{ gap: 6, fontSize: 13 }}>
              <DownloadIcon /> Download
            </DarkBtn>
          </div>
        }
      />
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 28px',
          display: 'flex',
          gap: 28,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 280 }}>
          <div
            style={{
              background: '#f5f0e8',
              borderRadius: 16,
              height: 460,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: `1px solid ${C.border}`,
            }}
          >
            <span style={{ fontSize: 64, opacity: 0.35 }}>👗</span>
          </div>
        </div>
        <div
          style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 20 }}
        >
          <div
            style={{
              background: C.white,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              padding: 20,
            }}
          >
            <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, color: C.text }}>
              File Details
            </h3>
            {FILE_DETAILS.map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingBottom: 10,
                  marginBottom: 10,
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <span style={{ fontSize: 13, color: C.mid }}>{k}</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{v}</span>
              </div>
            ))}
          </div>
          <div
            style={{
              background: C.white,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              padding: 20,
            }}
          >
            <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: C.text }}>
              Used In
            </h3>
            <div style={{ fontSize: 13, color: C.mid }}>No catalogues yet.</div>
          </div>
        </div>
      </div>
    </>
  );
}
