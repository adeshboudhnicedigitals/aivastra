'use client';

const MOCK_ASSETS = [
  { name: 'blue_kurta_flatlay.jpg', size: '2.4 MB', date: 'May 25, 2026', type: 'Top' },
  { name: 'floral_saree_clean.png', size: '3.1 MB', date: 'May 25, 2026', type: 'Saree' },
  { name: 'mens_white_shirt.jpg', size: '1.8 MB', date: 'May 24, 2026', type: 'Shirt' },
  { name: 'black_trousers_flat.jpg', size: '2.0 MB', date: 'May 24, 2026', type: 'Trouser' },
  { name: 'red_top_plain.png', size: '1.5 MB', date: 'May 23, 2026', type: 'Top' },
  { name: 'denim_jeans_blue.jpg', size: '2.8 MB', date: 'May 23, 2026', type: 'Jeans' },
  { name: 'green_kurta_set.jpg', size: '3.4 MB', date: 'May 22, 2026', type: 'Kurta' },
  { name: 'pink_skirt_cotton.png', size: '1.9 MB', date: 'May 22, 2026', type: 'Skirt' },
];

const BG_COLORS = ['#f5f0e8','#e8f0f5','#f0e8f5','#e8f5ee','#f5e8e8','#eef5e8','#f5f5e8','#e8e8f5'];

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
  </svg>
);
const FilterIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>
  </svg>
);
const UploadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
    <path d="M17 8l-5-5-5 5M12 3v12"/>
  </svg>
);

export default function AssetsPage(): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* TopBar */}
      <div className="av-topbar">
        <div>
          <div className="av-topbar-title">Your Assets</div>
          <div className="av-topbar-sub">Manage your uploaded garment images used for catalogue generation.</div>
        </div>
        <button className="av-btn-grad" style={{ gap: 8 }}>
          <UploadIcon /> Upload Asset
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--mute)', display: 'flex' }}>
              <SearchIcon />
            </span>
            <input
              placeholder="Search assets..."
              style={{
                width: '100%', paddingLeft: 34, height: 38, borderRadius: 8,
                border: '1px solid var(--line)', fontFamily: 'inherit', fontSize: 13,
                outline: 'none', background: 'var(--surface)',
              }}
            />
          </div>
          <button style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
            borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)',
            fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', color: 'var(--ink)',
          }}>
            <FilterIcon /> Filter
          </button>
        </div>

        {/* Grid */}
        <div className="av-assets-grid">
          {MOCK_ASSETS.map((asset, i) => (
            <div key={i} className="av-asset-card">
              <div className="av-asset-thumb" style={{ background: BG_COLORS[i % BG_COLORS.length] }}>
                <span style={{ opacity: .4 }}>👗</span>
              </div>
              <div className="av-asset-meta">
                <div className="av-asset-name">{asset.name}</div>
                <div className="av-asset-info">{asset.size} · {asset.date}</div>
                <span className="av-asset-badge">{asset.type}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
