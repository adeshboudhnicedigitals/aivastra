'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSession } from '@/components/session-provider';
import { C } from '@/components/tokens';
import { ListState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { canManageOrg } from '@/lib/roles';
import { toStoreUrlPayload, validateStoreUrl } from '@/lib/store-url';

type Brand = {
  companyName: string;
  storeUrl: string | null;
  logoUrl: string | null;
  logoOverlayEnabled: boolean;
  staffLimitPerBranch: number;
  deviceQuotaPerMonth: number | null;
};

const BRAND_KEY = ['merchant', 'brand'];
const card: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
};
const label: React.CSSProperties = { fontSize: 13, color: C.mid };
const value: React.CSSProperties = { fontSize: 15, color: C.text, fontWeight: 600, marginTop: 2 };
const btn = (primary?: boolean): React.CSSProperties => ({
  height: 36,
  padding: '0 14px',
  borderRadius: 8,
  border: primary ? 'none' : `1px solid ${C.border2}`,
  background: primary ? C.btnPrimary : C.white,
  color: primary ? C.white : C.text,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
});

function StoreLinkForm({ brand }: { brand: Brand }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState(brand.storeUrl ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (storeUrl: string | null) =>
      apiFetch<Brand>('/v1/merchant/brand', {
        method: 'PATCH',
        body: JSON.stringify({ storeUrl }),
      }),
    onSuccess: (next) => {
      qc.setQueryData(BRAND_KEY, next);
      setText(next.storeUrl ?? '');
      toast.show('Store link saved', 'success');
    },
    onError: (e: unknown) =>
      toast.show(e instanceof Error ? e.message : 'The request could not be completed.'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateStoreUrl(text);
    setError(err);
    if (err) return;
    save.mutate(toStoreUrlPayload(text));
  };

  return (
    <form onSubmit={submit} style={card}>
      <label htmlFor="store-url" style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
        Store link
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <input
          id="store-url"
          type="url"
          inputMode="url"
          placeholder="https://yourstore.com"
          maxLength={600}
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby="store-url-help"
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          style={{
            flex: '1 1 240px',
            height: 40,
            padding: '0 12px',
            borderRadius: 8,
            border: `1px solid ${error ? C.danger : C.border2}`,
            background: C.field,
            color: C.text,
            fontFamily: 'inherit',
            fontSize: 14,
            boxSizing: 'border-box',
            minWidth: 0,
          }}
        />
        <button type="submit" disabled={save.isPending} style={btn(true)}>
          {save.isPending ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => {
            setText('');
            setError(null);
          }}
          style={btn()}
        >
          Clear
        </button>
      </div>
      {error && (
        <div role="alert" style={{ color: C.danger, fontSize: 13, marginTop: 8 }}>
          {error}
        </div>
      )}
      <div id="store-url-help" style={{ fontSize: 12, color: C.light, marginTop: 8 }}>
        Shown as the 'Buy online' link on your shopper page. Leave empty and save to remove it.
      </div>
    </form>
  );
}

export default function SettingsPage() {
  const { me, status } = useSession();
  const router = useRouter();
  const isAdmin = !!me && canManageOrg(me.role);

  useEffect(() => {
    if (status === 'ready' && me && !canManageOrg(me.role)) router.replace('/');
  }, [status, me, router]);

  const brand = useQuery({
    queryKey: BRAND_KEY,
    queryFn: () => apiFetch<Brand>('/v1/merchant/brand'),
    enabled: isAdmin,
  });

  if (status !== 'ready' || !me || !isAdmin) return null;
  const b = brand.data;

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: '0 0 16px' }}>Settings</h1>
      <ListState
        status={brand.status}
        isEmpty={!b}
        emptyText="No settings found."
        error="Could not load settings."
        onRetry={() => void brand.refetch()}
      >
        {b && (
          <>
            <div style={card}>
              <div style={label}>Company</div>
              <div style={value}>{b.companyName}</div>

              <div style={{ ...label, marginTop: 14 }}>Logo</div>
              <div style={{ marginTop: 6 }}>
                {b.logoUrl ? (
                  // biome-ignore lint/performance/noImgElement: presigned storage URL, not optimizable by next/image
                  <img
                    src={b.logoUrl}
                    alt={`${b.companyName} logo`}
                    width={96}
                    height={96}
                    style={{
                      objectFit: 'contain',
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      background: C.white,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 96,
                      height: 96,
                      borderRadius: 8,
                      border: `1px dashed ${C.border2}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      color: C.light,
                    }}
                  >
                    No logo
                  </div>
                )}
              </div>
              <div style={{ ...value, fontWeight: 500, fontSize: 14, marginTop: 10 }}>
                Overlay logo on results: {b.logoOverlayEnabled ? 'On' : 'Off'}
              </div>
              <div style={{ fontSize: 12, color: C.light, marginTop: 6 }}>
                To change your logo, contact AiVastra.
              </div>

              <div style={{ ...label, marginTop: 14 }}>Staff limit per branch</div>
              <div style={value}>{b.staffLimitPerBranch}</div>
              <div style={{ ...label, marginTop: 14 }}>Device quota per month</div>
              <div style={value}>
                {b.deviceQuotaPerMonth === null ? 'Not set' : b.deviceQuotaPerMonth}
              </div>
            </div>
            <StoreLinkForm key={b.storeUrl ?? ''} brand={b} />
          </>
        )}
      </ListState>
    </div>
  );
}
