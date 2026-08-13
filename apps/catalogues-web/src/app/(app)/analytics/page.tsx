'use client';

import { TopBar } from '@/components/topbar';
import { AnalyticsPanel } from './AnalyticsPanel';

export default function AnalyticsPage(): React.ReactElement {
  return (
    <>
      <TopBar
        title="Analytics"
        subtitle="Job volume, success rate, credit spend, and recent outputs."
      />
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <AnalyticsPanel />
      </div>
    </>
  );
}
