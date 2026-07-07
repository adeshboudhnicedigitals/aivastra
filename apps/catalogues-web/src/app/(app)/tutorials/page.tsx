'use client';
import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';

export default function TutorialsPage() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar title="Tutorials" subtitle="" />
      <div
        style={{ flex: 1, overflowY: 'auto', padding: '28px', background: C.bg, color: C.mid }}
      ></div>
    </div>
  );
}
