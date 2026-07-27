import type { Toast } from './assets/AssetsContext';
import { AssetsProvider, useAssetsContext } from './assets/AssetsContext';
import { BackgroundsTab } from './assets/BackgroundsTab';
import { CatalogTab } from './assets/CatalogTab';
import { CatalogueTemplatesTab } from './assets/CatalogueTemplatesTab';
import { FacesTab } from './assets/FacesTab';
import { GarmentTypesTab } from './assets/GarmentTypesTab';
import { PoseAssetsTab } from './assets/PoseAssetsTab';
import { SampleVideosTab } from './assets/SampleVideosTab';
import { SareeStylesTab } from './assets/SareeStylesTab';

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: Toast;
}

const TABS = [
  { k: 'garment-types' as const, l: 'Garment Types' },
  { k: 'faces' as const, l: 'Model Faces' },
  { k: 'backgrounds' as const, l: 'Backgrounds' },
  { k: 'pose-assets' as const, l: 'Pose Assets' },
  { k: 'lower' as const, l: 'Lower garments' },
  { k: 'shoe' as const, l: 'Shoes' },
  { k: 'catalogue-templates' as const, l: 'Templates' },
  { k: 'saree-styles' as const, l: 'Saree Styles' },
  { k: 'sample-videos' as const, l: 'Sample Videos' },
];

function AssetsShell() {
  const { activeTab, setActiveTab, loading, previewUrl, setPreviewUrl } = useAssetsContext();

  return (
    <>
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.k}
            className={`tab ${activeTab === t.k ? 'active' : ''}`}
            onClick={() => setActiveTab(t.k)}
          >
            {t.l}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>Loading…</div>
      )}

      {activeTab === 'backgrounds' && <BackgroundsTab />}
      {activeTab === 'faces' && <FacesTab />}
      {activeTab === 'garment-types' && <GarmentTypesTab />}
      {activeTab === 'pose-assets' && <PoseAssetsTab />}
      {(activeTab === 'lower' || activeTab === 'shoe') && <CatalogTab />}
      {activeTab === 'catalogue-templates' && <CatalogueTemplatesTab />}
      {activeTab === 'saree-styles' && <SareeStylesTab />}
      {activeTab === 'sample-videos' && <SampleVideosTab />}

      {previewUrl && (
        <div
          onClick={() => setPreviewUrl(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.82)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            cursor: 'zoom-out',
          }}
        >
          {/* biome-ignore lint/performance/noImgElement: admin panel */}
          <img
            src={previewUrl}
            alt="preview"
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              borderRadius: 8,
              boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

export default function AssetsPage({ onNav: _onNav, toast }: Props) {
  return (
    <AssetsProvider toast={toast}>
      <AssetsShell />
    </AssetsProvider>
  );
}
