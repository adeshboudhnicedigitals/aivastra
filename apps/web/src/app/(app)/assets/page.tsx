'use client';
import { useEffect, useState } from 'react';
import { FilterIcon, ImagesIcon, SearchIcon, SortIcon, XIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { api } from '@/lib/api';

interface Asset {
  r2Key: string;
  uploadedAt: string;
  jobsCount: number;
}

interface AssetWithThumbnail extends Asset {
  thumbnailUrl?: string;
}

const ctlBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  borderRadius: 8,
  border: `1px solid ${C.border2}`,
  background: C.white,
  fontFamily: 'inherit',
  fontSize: 13,
  cursor: 'not-allowed',
  color: C.mid,
  opacity: 0.5,
};

export default function AssetsPage(): React.ReactElement {
  const [search, setSearch] = useState('');
  const [assets, setAssets] = useState<AssetWithThumbnail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [zoomVisible, setZoomVisible] = useState(false);

  useEffect(() => {
    if (zoom) {
      requestAnimationFrame(() => setZoomVisible(true));
    } else {
      setZoomVisible(false);
    }
  }, [zoom]);

  useEffect(() => {
    async function loadAssets() {
      try {
        setLoading(true);
        const rawAssets = await api.get<Asset[]>('/v1/assets');

        // Fetch thumbnail URLs for all assets
        const withThumbnails = await Promise.all(
          rawAssets.map(async (asset) => {
            try {
              const { thumbnailUrl } = await api.get<{ thumbnailUrl: string; expiresIn: number }>(
                `/v1/uploads/thumbnail?key=${encodeURIComponent(asset.r2Key)}`,
              );
              return { ...asset, thumbnailUrl };
            } catch {
              return asset;
            }
          }),
        );

        setAssets(withThumbnails);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load assets');
        setAssets([]);
      } finally {
        setLoading(false);
      }
    }

    loadAssets();
  }, []);

  const filtered = assets.filter((a) => a.r2Key.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <TopBar
        title="Your Assets"
        subtitle="Manage your uploaded garment images used for catalogue generation."
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
            <span
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: C.mid,
              }}
            >
              <SearchIcon />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assets..."
              disabled={loading}
              style={{
                width: '100%',
                paddingLeft: 34,
                height: 38,
                borderRadius: 8,
                border: `1px solid ${C.border2}`,
                fontFamily: 'inherit',
                fontSize: 13,
                outline: 'none',
                background: C.white,
                opacity: loading ? 0.6 : 1,
              }}
            />
          </div>
          <button type="button" style={ctlBtn} disabled>
            <FilterIcon /> Filter
          </button>
          <button type="button" style={ctlBtn} disabled>
            <SortIcon /> Sort
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              background: 'rgba(245,92,122,0.1)',
              color: C.pink,
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        {loading && (
          <div style={{ padding: '40px', textAlign: 'center', color: C.light, fontSize: 14 }}>
            Loading your assets...
          </div>
        )}

        {!loading && filtered.length === 0 && !error && (
          <div style={{ padding: '40px', textAlign: 'center', color: C.light, fontSize: 14 }}>
            {search
              ? 'No assets match your search'
              : 'No assets yet. Upload a garment to get started.'}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, 370px)',
              gap: 16,
            }}
          >
            {filtered.map((asset) => (
              <div
                key={asset.r2Key}
                style={{
                  width: 370,
                  height: 376,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  disabled={!asset.thumbnailUrl}
                  style={{
                    flex: 1,
                    background: asset.thumbnailUrl ? 'transparent' : '#f5f5f5',
                    position: 'relative',
                    overflow: 'hidden',
                    borderRadius: 8,
                    cursor: asset.thumbnailUrl ? 'pointer' : 'default',
                    border: 'none',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onClick={() => {
                    if (asset.thumbnailUrl) setZoom(asset.thumbnailUrl);
                  }}
                  onMouseOver={(e) => {
                    if (!asset.thumbnailUrl) return;
                    e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,0.12)';
                    const child = e.currentTarget.querySelector('div');
                    if (child) child.style.transform = 'scale(1.05)';
                  }}
                  onMouseOut={(e) => {
                    if (!asset.thumbnailUrl) return;
                    e.currentTarget.style.boxShadow = 'none';
                    const child = e.currentTarget.querySelector('div');
                    if (child) child.style.transform = 'scale(1)';
                  }}
                >
                  <div style={{ width: '100%', height: '100%', transition: 'transform .3s' }}>
                    {asset.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
                      <img
                        src={asset.thumbnailUrl}
                        alt=""
                        aria-hidden="true"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                          objectPosition: 'center',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <span style={{ fontSize: 40, opacity: 0.4 }}>👗</span>
                      </div>
                    )}
                  </div>
                </button>
                <div
                  style={{
                    height: 16,
                    padding: '0 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span style={{ color: C.mid, display: 'flex' }}>
                    <ImagesIcon size={16} />
                  </span>
                  <span style={{ fontSize: 13, color: C.mid }}>{asset.jobsCount}</span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: C.text,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {asset.r2Key.split('/').pop() || 'garment.jpg'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {zoom && (
        <div
          role="dialog"
          onClick={() => setZoom(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setZoom(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 40,
          }}
        >
          <button
            type="button"
            onClick={() => setZoom(null)}
            style={{
              position: 'absolute',
              top: 20,
              right: 20,
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              color: C.white,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <XIcon size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          <img
            src={zoom}
            alt=""
            aria-hidden="true"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 8,
              transform: zoomVisible ? 'translateX(0)' : 'translateX(100%)',
              transition: 'transform 300ms ease-out',
              pointerEvents: 'none',
            }}
          />
        </div>
      )}
    </>
  );
}
