import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckIcon,
  ChevronDownIcon,
  ProductsIcon,
  SearchIcon,
  SyncIcon,
} from '../components/icons';
import { Toast } from '../components/Toast';
import { apiFetch } from '../lib/api';
import { useToast } from '../lib/useToast';
import { BRAND } from '../theme';
import type { FunnelTemplateItem, ShopifyProductListItem } from '../types';

type DisplayStatus = 'active' | 'processing' | 'failed' | 'disabled';

// Reconciles two independent real-data axes (sync `status` and the `enabled`
// toggle) into the single status bucket shown in the UI: a disabled product
// always reads as "Disabled", regardless of its underlying sync status.
function displayStatus(item: ShopifyProductListItem): DisplayStatus {
  if (!item.enabled || item.status === 'deleted') return 'disabled';
  return item.status as DisplayStatus;
}

const STATUS_LABEL: Record<DisplayStatus, string> = {
  active: 'Active',
  processing: 'Processing',
  failed: 'Failed',
  disabled: 'Disabled',
};

const STATUS_DOT: Record<DisplayStatus, string> = {
  active: BRAND.success,
  processing: BRAND.warning,
  failed: BRAND.danger,
  disabled: BRAND.disabledDot,
};

const STATUS_BG: Record<DisplayStatus, string> = {
  active: BRAND.successBg,
  processing: BRAND.warningBg,
  failed: BRAND.dangerBg,
  disabled: BRAND.disabledBg,
};

const STATUS_TEXT: Record<DisplayStatus, string> = {
  active: BRAND.successText,
  processing: BRAND.warningText,
  failed: BRAND.dangerStrong,
  disabled: BRAND.disabledText,
};

function StatusPill({ status }: { status: DisplayStatus }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '12px',
        fontWeight: 700,
        padding: '4px 10px',
        borderRadius: '999px',
        background: STATUS_BG[status],
        color: STATUS_TEXT[status],
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: STATUS_DOT[status],
          display: 'inline-block',
          animation: status === 'processing' ? 'pulseDot 1.6s ease-in-out infinite' : undefined,
        }}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

function EnabledToggle({
  enabled,
  locked,
  onClick,
}: {
  enabled: boolean;
  locked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={locked}
      title={enabled ? 'Enabled' : 'Disabled'}
      style={{
        width: '40px',
        height: '22px',
        borderRadius: '999px',
        border: 'none',
        background: enabled ? BRAND.purple : '#E3E0EA',
        cursor: locked ? 'not-allowed' : 'pointer',
        position: 'relative',
        padding: 0,
        opacity: locked ? 0.45 : 1,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '2px',
          left: enabled ? '20px' : '2px',
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          background: '#fff',
          transition: 'left .15s',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }}
      />
    </button>
  );
}

function FunnelDropdown({
  currentFunnelId,
  funnelTemplates,
  open,
  onToggle,
  onSelect,
}: {
  currentFunnelId: string | null;
  funnelTemplates: FunnelTemplateItem[];
  open: boolean;
  onToggle: () => void;
  onSelect: (funnelId: string | null) => void;
}) {
  const isAutomated = !currentFunnelId;
  const current = funnelTemplates.find((f) => f.id === currentFunnelId);
  const label = isAutomated ? 'Automated' : (current?.label ?? 'Automated');

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          height: '34px',
          padding: '0 12px',
          borderRadius: '9px',
          cursor: 'pointer',
          fontSize: '12.5px',
          fontWeight: 600,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          whiteSpace: 'nowrap',
          border: `1px solid ${isAutomated ? BRAND.purpleBorder : BRAND.borderStrong}`,
          background: isAutomated ? BRAND.purpleTint : '#fff',
          color: isAutomated ? BRAND.purpleDark : BRAND.inkSoft,
        }}
      >
        {label}
        <ChevronDownIcon size={12} color="currentColor" />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: '210px',
            background: '#fff',
            border: `1px solid ${BRAND.border}`,
            borderRadius: '12px',
            boxShadow: '0 16px 36px rgba(23,15,38,0.16)',
            padding: '6px',
            zIndex: 25,
            boxSizing: 'border-box',
          }}
        >
          <button
            type="button"
            onClick={() => onSelect(null)}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              border: 'none',
              background: 'none',
              borderRadius: '8px',
              fontSize: '13px',
              color: BRAND.inkSoft,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            Automated (no manual pin)
            {isAutomated && <CheckIcon size={13} color={BRAND.purple} strokeWidth={2.5} />}
          </button>
          {funnelTemplates.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onSelect(f.id)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                border: 'none',
                background: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                color: BRAND.inkSoft,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              {f.label}
              {f.id === currentFunnelId && (
                <CheckIcon size={13} color={BRAND.purple} strokeWidth={2.5} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProductsPage() {
  const [items, setItems] = useState<ShopifyProductListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [funnelTemplates, setFunnelTemplates] = useState<FunnelTemplateItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const [openDropdownId, setOpenDropdownId] = useState<number | null>(null);
  const { toast, showToast } = useToast();

  const filteredItems = useMemo(() => {
    return items
      .filter((item) => statusFilter === 'all' || displayStatus(item) === statusFilter)
      .filter((item) => (item.title ?? '').toLowerCase().includes(searchQuery.toLowerCase()));
  }, [items, statusFilter, searchQuery]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiFetch<{ items: ShopifyProductListItem[] }>('/v1/shopify/products?pageSize=100'),
      apiFetch<{ items: FunnelTemplateItem[] }>('/v1/shopify/funnel-templates'),
    ])
      .then(([products, funnels]) => {
        setItems(products.items);
        setFunnelTemplates(funnels.items);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refreshProducts = useCallback(async () => {
    setError(null);
    setSyncing(true);
    try {
      await apiFetch('/v1/shopify/products/sync', { method: 'POST' });
      showToast('Refreshing your catalog from Shopify — this can take a minute.');
      // Sync runs async on the server (Redis-queued, paginated against Shopify's
      // Admin API) — nothing to await here. Re-poll the list once, giving a
      // typical single-page catalog time to land before showing it.
      setTimeout(() => {
        load();
        setSyncing(false);
      }, 4000);
    } catch (err) {
      setError((err as Error).message);
      setSyncing(false);
    }
  }, [load, showToast]);

  async function toggleEnabled(shopifyProductId: number, enabled: boolean) {
    setError(null);
    try {
      const updated = await apiFetch<ShopifyProductListItem>(
        `/v1/shopify/products/${shopifyProductId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ enabled }),
        },
      );
      setItems((prev) => prev.map((p) => (p.shopifyProductId === shopifyProductId ? updated : p)));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function setFunnel(shopifyProductId: number, funnelTemplateId: string | null) {
    setError(null);
    setOpenDropdownId(null);
    try {
      await apiFetch(`/v1/shopify/products/${shopifyProductId}/funnel`, {
        method: 'PATCH',
        body: JSON.stringify({ funnelTemplateId }),
      });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '20px',
        }}
      >
        <div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: BRAND.ink }}>Products</div>
          <div style={{ marginTop: '4px', fontSize: '14px', color: BRAND.textMuted }}>
            {items.length} product{items.length === 1 ? '' : 's'} synced from Shopify.
          </div>
        </div>
        <button
          type="button"
          onClick={refreshProducts}
          disabled={syncing}
          style={{
            height: '38px',
            padding: '0 16px',
            border: `1px solid ${BRAND.borderStrong}`,
            borderRadius: '10px',
            background: '#fff',
            color: BRAND.inkSoft,
            fontSize: '13.5px',
            fontWeight: 600,
            cursor: syncing ? 'default' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '7px',
            whiteSpace: 'nowrap',
          }}
        >
          <SyncIcon size={14} />
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {error && (
        <div
          style={{
            background: BRAND.dangerBg,
            border: '1px solid rgba(200,30,58,0.18)',
            borderRadius: '14px',
            padding: '12px 16px',
            marginBottom: '16px',
            fontSize: '13.5px',
            color: '#8C1830',
          }}
        >
          {error}
        </div>
      )}

      {!loading && items.length === 0 ? (
        <div
          style={{
            background: '#fff',
            border: `1px solid ${BRAND.border}`,
            borderRadius: '16px',
            padding: '64px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: BRAND.purpleTint,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: BRAND.purple,
            }}
          >
            <ProductsIcon size={26} />
          </div>
          <div style={{ marginTop: '18px', fontSize: '16px', fontWeight: 700, color: BRAND.ink }}>
            No products synced yet
          </div>
          <div
            style={{
              marginTop: '6px',
              fontSize: '13.5px',
              color: BRAND.textMuted,
              maxWidth: '320px',
              lineHeight: 1.6,
            }}
          >
            Sync now to bring in your Shopify catalog.
          </div>
          <button
            type="button"
            onClick={refreshProducts}
            style={{
              marginTop: '20px',
              height: '38px',
              padding: '0 18px',
              border: 'none',
              borderRadius: '10px',
              background: BRAND.buttonGradient,
              color: '#fff',
              fontSize: '13.5px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Sync now
          </button>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: '320px' }}>
              <span
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
              >
                <SearchIcon size={15} />
              </span>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products"
                style={{
                  width: '100%',
                  height: '38px',
                  border: `1px solid ${BRAND.borderInput}`,
                  borderRadius: '10px',
                  padding: '0 14px 0 36px',
                  fontSize: '13.5px',
                  color: BRAND.ink,
                  background: '#fff',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                height: '38px',
                border: `1px solid ${BRAND.borderInput}`,
                borderRadius: '10px',
                padding: '0 12px',
                fontSize: '13px',
                color: BRAND.inkSoft,
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="processing">Processing</option>
              <option value="failed">Failed</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>

          <div
            style={{
              background: '#fff',
              border: `1px solid ${BRAND.border}`,
              borderRadius: '16px',
              paddingBottom: '6px',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2.4fr 1fr 0.8fr 1.8fr',
                gap: '12px',
                padding: '14px 20px 12px',
                fontSize: '11.5px',
                fontWeight: 700,
                color: BRAND.textFaint,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                borderBottom: `1px solid ${BRAND.border}`,
              }}
            >
              <div>Product</div>
              <div>Status</div>
              <div>Try-On</div>
              <div>Funnel template</div>
            </div>

            {loading && (
              <div
                style={{
                  padding: '24px 20px',
                  textAlign: 'center',
                  color: BRAND.textMuted,
                  fontSize: '13px',
                }}
              >
                Loading products…
              </div>
            )}

            {!loading &&
              filteredItems.map((item) => {
                const status = displayStatus(item);
                const locked = item.status === 'processing' || item.status === 'failed';
                return (
                  <div
                    key={item.shopifyProductId}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '2.4fr 1fr 0.8fr 1.8fr',
                      gap: '12px',
                      alignItems: 'center',
                      padding: '12px 20px',
                      borderTop: `1px solid rgba(23,15,38,0.06)`,
                    }}
                  >
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}
                    >
                      {/* biome-ignore lint/performance/noImgElement: dynamic remote thumbnail */}
                      <img
                        src={item.thumbnailUrl}
                        alt=""
                        style={{
                          width: '40px',
                          height: '40px',
                          flexShrink: 0,
                          borderRadius: '10px',
                          objectFit: 'cover',
                          background: '#F1F0F5',
                        }}
                      />
                      <span
                        style={{
                          fontSize: '14px',
                          fontWeight: 600,
                          color: BRAND.ink,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {item.title}
                      </span>
                    </div>
                    <div>
                      <StatusPill status={status} />
                    </div>
                    <div>
                      <EnabledToggle
                        enabled={item.enabled}
                        locked={locked}
                        onClick={() => toggleEnabled(item.shopifyProductId, !item.enabled)}
                      />
                    </div>
                    <FunnelDropdown
                      currentFunnelId={item.funnelTemplateId}
                      funnelTemplates={funnelTemplates}
                      open={openDropdownId === item.shopifyProductId}
                      onToggle={() =>
                        setOpenDropdownId((cur) =>
                          cur === item.shopifyProductId ? null : item.shopifyProductId,
                        )
                      }
                      onSelect={(funnelId) => setFunnel(item.shopifyProductId, funnelId)}
                    />
                  </div>
                );
              })}

            {!loading && filteredItems.length === 0 && (
              <div
                style={{
                  padding: '56px 24px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '14.5px', fontWeight: 700, color: BRAND.ink }}>
                  No products match your filters
                </div>
                <div style={{ marginTop: '4px', fontSize: '13px', color: BRAND.textMuted }}>
                  Try a different search term or status.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter('all');
                  }}
                  style={{
                    marginTop: '12px',
                    border: 'none',
                    background: 'none',
                    color: BRAND.purple,
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {openDropdownId !== null && (
        // biome-ignore lint/a11y/noStaticElementInteractions: click-outside-to-close overlay; dropdown items remain keyboard-reachable buttons
        <div
          role="presentation"
          style={{ position: 'fixed', inset: 0, zIndex: 15 }}
          onClick={() => setOpenDropdownId(null)}
        />
      )}

      <Toast message={toast} />
    </div>
  );
}
