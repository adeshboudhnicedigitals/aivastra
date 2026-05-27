'use client';
import Link from 'next/link';
import { useState } from 'react';
import { C, BG_TINTS } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { GradBtn } from '@/components/ui/grad-btn';
import { SearchIcon, FilterIcon, SortIcon, UploadIcon } from '@/components/icons';

// TODO(wire): no assets endpoint yet — mock data, design shell only.
const MOCK_ASSETS = [
  { id: '1', name: 'blue_kurta_flatlay.jpg', size: '2.4 MB', date: 'May 25, 2026', type: 'Top' },
  { id: '2', name: 'floral_saree_clean.png', size: '3.1 MB', date: 'May 25, 2026', type: 'Saree' },
  { id: '3', name: 'mens_white_shirt.jpg', size: '1.8 MB', date: 'May 24, 2026', type: 'Shirt' },
  { id: '4', name: 'black_trousers_flat.jpg', size: '2.0 MB', date: 'May 24, 2026', type: 'Trouser' },
  { id: '5', name: 'red_top_plain.png', size: '1.5 MB', date: 'May 23, 2026', type: 'Top' },
  { id: '6', name: 'denim_jeans_blue.jpg', size: '2.8 MB', date: 'May 23, 2026', type: 'Jeans' },
  { id: '7', name: 'green_kurta_set.jpg', size: '3.4 MB', date: 'May 22, 2026', type: 'Kurta' },
  { id: '8', name: 'pink_skirt_cotton.png', size: '1.9 MB', date: 'May 22, 2026', type: 'Skirt' },
];

const ctlBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
  borderRadius: 8, border: `1px solid ${C.border2}`, background: C.white,
  fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', color: C.text,
};

export default function AssetsPage(): React.ReactElement {
  const [search, setSearch] = useState('');
  const assets = MOCK_ASSETS.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <TopBar
        title="Your Assets"
        subtitle="Manage your uploaded garment images used for catalogue generation."
        right={<GradBtn style={{ gap: 8 }}><UploadIcon /> Upload Asset</GradBtn>}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.mid }}><SearchIcon /></span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assets..." style={{ width: '100%', paddingLeft: 34, height: 38, borderRadius: 8, border: `1px solid ${C.border2}`, fontFamily: 'inherit', fontSize: 13, outline: 'none', background: C.white }} />
          </div>
          <button style={ctlBtn}><FilterIcon /> Filter</button>
          <button style={ctlBtn}><SortIcon /> Sort</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          {assets.map((asset, i) => (
            <Link key={asset.id} href={`/assets/${asset.id}`} style={{ textDecoration: 'none' }}>
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', cursor: 'pointer', transition: 'box-shadow .15s' }}
                onMouseOver={(e) => { e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.08)'; }}
                onMouseOut={(e) => { e.currentTarget.style.boxShadow = 'none'; }}>
                <div style={{ height: 180, background: BG_TINTS[i % BG_TINTS.length], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 40, opacity: 0.4 }}>👗</span>
                </div>
                <div style={{ padding: '10px 14px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.name}</div>
                  <div style={{ fontSize: 11, color: C.light }}>{asset.size} · {asset.date}</div>
                  <div style={{ display: 'inline-block', marginTop: 6, padding: '2px 8px', borderRadius: 4, background: 'rgba(245,92,122,0.1)', color: C.pink, fontSize: 11, fontWeight: 500 }}>{asset.type}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
