'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { C } from '@/components/tokens';
import { api } from '@/lib/api';
import { MOCK_PRODUCT, SHOPIFY_LEFT_NAV, SHOPIFY_SALES_CHANNELS } from './shopify-mock-data';

export interface MediaImage {
  id: string;
  url: string;
  source: 'seed' | 'aivastra';
}

function ShopifyChrome({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#f1f2f4',
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'inherit',
      }}
    >
      <div
        style={{
          height: 48,
          background: '#0e0e0e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          color: '#fff',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>shopify</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              background: 'rgba(255,255,255,0.12)',
              borderRadius: 6,
              padding: '2px 8px',
            }}
          >
            Spring '26
          </span>
        </div>
        <div style={{ fontSize: 12, color: '#c9cccf' }}>Ai Vastra Store Dev</div>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div
          style={{
            width: 200,
            background: '#0e0e0e',
            color: '#c9cccf',
            flexShrink: 0,
            padding: '16px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            fontSize: 13,
          }}
        >
          {SHOPIFY_LEFT_NAV.map((label) => (
            <div
              key={label}
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                fontWeight: label === 'Products' ? 600 : 400,
                background: label === 'Products' ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: label === 'Products' ? '#fff' : '#c9cccf',
              }}
            >
              {label}
            </div>
          ))}
          <div style={{ marginTop: 16, fontSize: 11, color: '#8a8d93', padding: '0 12px' }}>
            Sales channels
          </div>
          {SHOPIFY_SALES_CHANNELS.map((label) => (
            <div key={label} style={{ padding: '8px 12px', borderRadius: 6, fontSize: 13 }}>
              {label}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>{children}</div>
      </div>
    </div>
  );
}

function StaticCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e3e3e3',
        borderRadius: 12,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {title && (
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{title}</h3>
      )}
      {children}
    </div>
  );
}

function StaticField({
  label,
  value,
  placeholder,
  multiline,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{label}</span>
      <div
        style={{
          border: '1px solid #c9cccf',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 14,
          color: value ? '#1a1a1a' : '#8a8a8a',
          background: '#fff',
          minHeight: multiline ? 120 : undefined,
        }}
      >
        {value || placeholder}
      </div>
    </div>
  );
}

export function ShopifyPluginDemo() {
  const { data: me, isLoading: meLoading } = useQuery<{ isMerchant?: boolean }>({
    queryKey: ['me'],
    queryFn: () => api.get('/v1/me'),
    retry: false,
  });

  const [mediaImages, _setMediaImages] = useState<MediaImage[]>([
    { id: 'seed', url: MOCK_PRODUCT.seedMediaUrl, source: 'seed' },
  ]);

  if (!meLoading && !me?.isMerchant) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: C.mid, fontSize: 14 }}>
        This preview is available for merchant accounts. Contact us to enable merchant features on
        your account.
      </div>
    );
  }

  return (
    <ShopifyChrome>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 20 }}>
        <span style={{ fontSize: 12, color: '#6b6f76' }}>Products &gt; Add product</span>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, color: '#1a1a1a' }}>Add product</h1>
      </div>
      <div
        style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, alignItems: 'start' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <StaticCard>
            <StaticField label="Title" value={MOCK_PRODUCT.title} />
            <StaticField label="Description" multiline placeholder="Short sleeve t-shirt" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>Media</span>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {mediaImages.map((img) => (
                  <div
                    key={img.id}
                    style={{
                      position: 'relative',
                      width: 100,
                      height: 100,
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: '1px solid #c9cccf',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </div>
                ))}
                <div
                  style={{
                    width: 100,
                    height: 100,
                    borderRadius: 8,
                    border: '1px dashed #c9cccf',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#8a8a8a',
                    fontSize: 24,
                  }}
                >
                  +
                </div>
              </div>
            </div>
            <StaticField label="Category" placeholder="Choose a product category" />
          </StaticCard>
          <StaticCard title="Price">
            <div style={{ display: 'flex', gap: 12 }}>
              <StaticField label="Price" value="$ 0.00" />
              <StaticField label="Compare-at price" placeholder="$ 0.00" />
            </div>
          </StaticCard>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <StaticCard title="Status">
            <StaticField label="" value="Active" />
          </StaticCard>
          <StaticCard title="Publishing">
            <StaticField label="" value="All channels" />
          </StaticCard>
          <StaticCard title="Product organization">
            <StaticField label="Type" placeholder="None" />
            <StaticField label="Vendor" placeholder="None" />
            <StaticField label="Collections" placeholder="+ Add collections" />
            <StaticField label="Tags" placeholder="+ Add tags" />
          </StaticCard>
          <StaticCard title="Theme template">
            <StaticField label="" value="Default product" />
          </StaticCard>
        </div>
      </div>
    </ShopifyChrome>
  );
}
