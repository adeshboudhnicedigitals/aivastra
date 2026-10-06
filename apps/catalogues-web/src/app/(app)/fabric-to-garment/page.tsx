'use client';

import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { FabricToGarmentPreviewPanel } from './fabric-to-garment-preview-panel';
import { FabricToGarmentSection } from './fabric-to-garment-section';
import { useFabricToGarment } from './use-fabric-to-garment';

export default function FabricToGarmentPage() {
  const f = useFabricToGarment();

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar
        title="Fabric to Garment"
        subtitle="Turn a flat fabric photo into a ready-to-wear garment mockup"
      />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '20px 20px 24px',
          boxSizing: 'border-box',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr',
          gap: 20,
          background: C.bg,
        }}
      >
        <FabricToGarmentSection
          previewUrl={f.previewUrl}
          uploading={f.uploading}
          uploadProgress={f.uploadProgress}
          uploadError={f.uploadError}
          onFile={f.handleUpload}
          onRemove={f.removeFile}
          presetId={f.presetId}
          onSelectPreset={f.setPresetId}
          submitting={f.submitting}
          submitError={f.submitError}
          canSubmit={f.canSubmit}
          onSubmit={f.submit}
        />
        <FabricToGarmentPreviewPanel
          garmentPreviewUrl={f.previewUrl}
          jobStatus={f.jobStatus}
          resultUrl={f.resultUrl}
          generating={f.generating}
          onGenerateAnother={f.generateAnother}
        />
      </div>
    </div>
  );
}
