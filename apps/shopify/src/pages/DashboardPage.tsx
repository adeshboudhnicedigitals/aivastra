import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Toast } from '../components/Toast';
import { apiFetch } from '../lib/api';
import { useToast } from '../lib/useToast';
import { BRAND } from '../theme';
import type { ShopifyMe, ShopifyOnboardingConfirmResponse } from '../types';

const STATUS_DOT: Record<'active' | 'processing' | 'failed' | 'disabled', string> = {
  active: BRAND.success,
  processing: BRAND.warning,
  failed: BRAND.danger,
  disabled: BRAND.disabledDot,
};

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '10px',
        background: BRAND.dangerBg,
        border: '1px solid rgba(200,30,58,0.18)',
        borderRadius: '14px',
        padding: '12px 16px',
        marginBottom: '20px',
        fontSize: '13.5px',
        color: '#8C1830',
        boxSizing: 'border-box',
      }}
    >
      {message}
    </div>
  );
}

function StepRow({
  done,
  title,
  desc,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  primaryLoading,
}: {
  done: boolean;
  title: string;
  desc: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  primaryLoading?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '14px',
        padding: '14px 0',
        borderTop: `1px solid rgba(23,15,38,0.06)`,
      }}
    >
      {done ? (
        <div
          style={{
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            background: BRAND.success,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            marginTop: '1px',
          }}
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 13l4 4L19 7"
              stroke="#fff"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      ) : (
        <div
          style={{
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            border: '2px solid #DCD8E6',
            flexShrink: 0,
            marginTop: '1px',
            boxSizing: 'border-box',
          }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: BRAND.ink }}>{title}</div>
        <div
          style={{ marginTop: '2px', fontSize: '13px', color: BRAND.textMuted, lineHeight: 1.5 }}
        >
          {desc}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexShrink: 0, alignItems: 'center' }}>
        {secondaryLabel && onSecondary && (
          <button
            type="button"
            onClick={onSecondary}
            style={{
              height: '34px',
              padding: '0 13px',
              border: `1px solid ${BRAND.borderStrong}`,
              borderRadius: '9px',
              background: '#fff',
              color: BRAND.inkSoft,
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {secondaryLabel}
          </button>
        )}
        {done ? (
          <span style={{ fontSize: '13px', fontWeight: 600, color: BRAND.successText }}>Done</span>
        ) : (
          <button
            type="button"
            onClick={onPrimary}
            disabled={primaryLoading}
            style={{
              height: '34px',
              padding: '0 13px',
              border: 'none',
              borderRadius: '9px',
              background: BRAND.buttonGradient,
              color: '#fff',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: primaryLoading ? 'default' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {primaryLoading ? 'Working…' : primaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  iconBg,
  iconColor,
  label,
  value,
  sub,
  subColor,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  label: string;
  value: React.ReactNode;
  sub?: string;
  subColor?: string;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${BRAND.border}`,
        borderRadius: '16px',
        padding: '20px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '38px',
          height: '38px',
          borderRadius: '11px',
          background: iconBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: iconColor,
        }}
      >
        {icon}
      </div>
      <div style={{ marginTop: '14px', fontSize: '13px', color: BRAND.textMuted, fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ marginTop: '2px', fontSize: '26px', fontWeight: 700, color: BRAND.ink }}>
        {value}
      </div>
      {sub && (
        <div
          style={{
            marginTop: '6px',
            fontSize: '12.5px',
            fontWeight: 600,
            color: subColor ?? BRAND.textFaint,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [me, setMe] = useState<ShopifyMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [openingEditor, setOpeningEditor] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const navigate = useNavigate();
  const { toast, showToast } = useToast();

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<ShopifyMe>('/v1/shopify/me')
      .then(setMe)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function syncProducts() {
    setSyncing(true);
    setError(null);
    try {
      await apiFetch('/v1/shopify/products/sync', { method: 'POST' });
      showToast('Products synced from Shopify.');
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function openThemeEditor() {
    setOpeningEditor(true);
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>('/v1/shopify/onboarding/theme-editor-url');
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOpeningEditor(false);
    }
  }

  async function disconnectAccount() {
    setDisconnecting(true);
    setError(null);
    try {
      await apiFetch('/v1/shopify/store/account/unlink', { method: 'POST' });
      // Full reload so App.tsx re-fetches /v1/shopify/me from scratch and
      // re-gates to LinkAccountGate now that ownerUserId is cleared server-side.
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
      setDisconnecting(false);
    }
  }

  async function confirmThemeBlock() {
    setConfirming(true);
    setError(null);
    try {
      const { settings } = await apiFetch<ShopifyOnboardingConfirmResponse>(
        '/v1/shopify/onboarding/confirm-theme-block',
        { method: 'POST' },
      );
      setMe((prev) => (prev ? { ...prev, store: { ...prev.store, settings } } : prev));
      showToast('Got it — Try It On block confirmed.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div
        style={{
          background: '#fff',
          border: `1px solid ${BRAND.border}`,
          borderRadius: '16px',
          padding: '40px',
          color: BRAND.textMuted,
          fontSize: '13.5px',
        }}
      >
        Loading…
      </div>
    );
  }

  const synced = (me?.stats.syncedProductCount ?? 0) > 0;
  const enabled = (me?.stats.enabledProductCount ?? 0) > 0;
  const themeBlockDone = me?.store.settings.themeBlockConfirmed ?? false;
  const doneCount = [synced, enabled, themeBlockDone].filter(Boolean).length;
  const allDone = doneCount === 3;
  const collapsed = allDone && !expanded;

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '22px', fontWeight: 700, color: BRAND.ink }}>Dashboard</div>
        <div style={{ marginTop: '4px', fontSize: '14px', color: BRAND.textMuted }}>
          Here's how virtual try-on is performing on your store.
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div
        style={{
          background: '#fff',
          border: `1px solid ${BRAND.border}`,
          borderRadius: '18px',
          marginBottom: '24px',
          overflow: 'hidden',
          boxShadow: '0 1px 2px rgba(23,15,38,0.03)',
        }}
      >
        <div style={{ height: '4px', background: '#F0EDF6' }}>
          <div
            style={{
              height: '4px',
              background: 'linear-gradient(90deg,#7C3AED,#BD2587)',
              width: `${Math.round((doneCount / 3) * 100)}%`,
              transition: 'width .4s',
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            display: 'flex',
            width: '100%',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px 4px',
            cursor: 'pointer',
            border: 'none',
            background: 'none',
            textAlign: 'left',
            font: 'inherit',
            color: 'inherit',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '15.5px', fontWeight: 700, color: BRAND.ink }}>
              Getting started
            </span>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: BRAND.purpleDark,
                background: BRAND.purpleTint,
                padding: '3px 9px',
                borderRadius: '999px',
              }}
            >
              {doneCount}/3
            </span>
          </div>
          <svg
            aria-hidden="true"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            style={{ color: BRAND.textFaint, transform: collapsed ? 'none' : 'rotate(180deg)' }}
          >
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {!collapsed && (
          <div style={{ padding: '6px 24px 20px' }}>
            <StepRow
              done={synced}
              title="Sync your products"
              desc="Import your Shopify catalog so AiVastra can generate try-on images."
              primaryLabel="Sync products now"
              onPrimary={syncProducts}
              primaryLoading={syncing}
            />
            <StepRow
              done={enabled}
              title="Enable try-on on a product"
              desc="Turn on virtual try-on for at least one product."
              primaryLabel="Go to Products"
              onPrimary={() => navigate('/products')}
            />
            <StepRow
              done={themeBlockDone}
              title="Add the Try It On block to your theme"
              desc="Add the block in the theme editor so shoppers can see it on your product pages."
              primaryLabel="I've added it"
              onPrimary={confirmThemeBlock}
              primaryLoading={confirming}
              secondaryLabel="Open theme editor"
              onSecondary={openThemeEditor}
            />
            {openingEditor && (
              <div style={{ marginTop: '4px', fontSize: '12px', color: BRAND.textFaint }}>
                Opening theme editor…
              </div>
            )}
          </div>
        )}

        {collapsed && (
          <div
            style={{
              padding: '0 24px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '13.5px',
              fontWeight: 600,
              color: BRAND.successText,
            }}
          >
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 13l4 4L19 7"
                stroke={BRAND.successText}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            All set — virtual try-on is live on your store.
          </div>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3,1fr)',
          gap: '16px',
          marginBottom: '16px',
        }}
      >
        <StatCard
          icon={
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2z" />
            </svg>
          }
          iconBg="#FCE4F1"
          iconColor="#BD2587"
          label="Try-Ons"
          value={me?.stats.totalTryOns ?? 0}
        />
        <StatCard
          icon={
            <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path
                d="M4.5 7.5L12 12l7.5-4.5M12 12v9"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          }
          iconBg="#EFE7FC"
          iconColor="#7C3AED"
          label="Products Synced"
          value={me?.stats.syncedProductCount ?? 0}
          sub="from Shopify"
        />
        <StatCard
          icon={
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8.5 3L5 6l1.8 2.8L8 8v11h8V8l1.2.8L19 6l-3.5-3-1 1.3a3 3 0 0 1-4 0L8.5 3z" />
            </svg>
          }
          iconBg="#FDE7DC"
          iconColor="#E0562F"
          label="Products Enabled"
          value={me?.stats.enabledProductCount ?? 0}
          sub={`of ${me?.stats.syncedProductCount ?? 0} synced`}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.1fr 1fr',
          gap: '16px',
          marginBottom: '8px',
        }}
      >
        <div
          style={{
            background: '#fff',
            border: `1px solid ${BRAND.border}`,
            borderRadius: '16px',
            padding: '22px 24px',
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '10px',
              background: BRAND.successBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#1F9254',
              marginBottom: '12px',
            }}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M12 7.5v9M9.5 9.5c0-1 1-1.8 2.5-1.8s2.5.8 2.5 1.8-1 1.3-2.5 1.5c-1.5.2-2.5.7-2.5 1.7s1 1.8 2.5 1.8 2.5-.6 2.5-1.6"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: BRAND.textMuted }}>
            Credit balance
          </div>
          <div style={{ marginTop: '8px', fontSize: '27px', fontWeight: 700, color: BRAND.ink }}>
            {me?.creditBalance ?? 0}{' '}
            <span style={{ fontSize: '13.5px', fontWeight: 500, color: BRAND.textFaint }}>
              credits
            </span>
          </div>
          <a
            href="https://app.aivastra.com/pricing"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              marginTop: '16px',
              alignSelf: 'flex-start',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              fontWeight: 600,
              color: '#fff',
              background: BRAND.buttonGradient,
              padding: '9px 16px',
              borderRadius: '10px',
              textDecoration: 'none',
            }}
          >
            Top up on aivastra.com
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path
                d="M7 17L17 7M9 7h8v8"
                stroke="#fff"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </div>

        <div
          style={{
            background: '#fff',
            border: `1px solid ${BRAND.border}`,
            borderRadius: '16px',
            padding: '22px 24px',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: BRAND.textMuted,
              marginBottom: '14px',
            }}
          >
            Sync status
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {(['active', 'processing', 'failed', 'disabled'] as const).map((key) => (
              <div
                key={key}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: STATUS_DOT[key],
                      display: 'inline-block',
                      animation:
                        key === 'processing' ? 'pulseDot 1.6s ease-in-out infinite' : undefined,
                    }}
                  />
                  <span
                    style={{
                      fontSize: '13.5px',
                      color: BRAND.inkSoft,
                      textTransform: 'capitalize',
                    }}
                  >
                    {key}
                  </span>
                </div>
                <span style={{ fontSize: '13.5px', fontWeight: 700, color: BRAND.ink }}>
                  {me?.stats.statusCounts[key] ?? 0}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: '16px',
          padding: '18px 4px 0',
          borderTop: '1px solid rgba(23,15,38,0.08)',
        }}
      >
        <a
          href="/products"
          onClick={(e) => {
            e.preventDefault();
            navigate('/products');
          }}
          style={{
            fontSize: '13.5px',
            fontWeight: 600,
            color: BRAND.purple,
            textDecoration: 'none',
          }}
        >
          Manage Products →
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
          {me?.store.connectedSince && (
            <span style={{ fontSize: '13px', color: BRAND.textFaint }}>
              Connected since {new Date(me.store.connectedSince).toLocaleDateString()}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowDisconnect(true)}
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: BRAND.dangerStrong,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            Disconnect account
          </button>
        </div>
      </div>

      {showDisconnect && (
        // biome-ignore lint/a11y/noStaticElementInteractions: click-outside-to-dismiss backdrop; Cancel button below is the keyboard path
        <div
          role="presentation"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(23,15,38,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
            padding: '20px',
            boxSizing: 'border-box',
          }}
          onClick={() => setShowDisconnect(false)}
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation only */}
          <div
            role="presentation"
            style={{
              width: '400px',
              maxWidth: '100%',
              background: '#fff',
              borderRadius: '18px',
              padding: '28px',
              boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
              boxSizing: 'border-box',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '17px', fontWeight: 700, color: BRAND.ink }}>
              Disconnect AiVastra?
            </div>
            <div
              style={{
                marginTop: '10px',
                fontSize: '13.5px',
                lineHeight: 1.6,
                color: BRAND.textMuted,
              }}
            >
              Shoppers will stop seeing the Try It On button on your storefront until you reconnect.
              Your AiVastra account, credits, and history stay safe at app.aivastra.com.
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
                marginTop: '24px',
              }}
            >
              <button
                type="button"
                onClick={() => setShowDisconnect(false)}
                style={{
                  height: '38px',
                  padding: '0 16px',
                  border: `1px solid ${BRAND.borderStrong}`,
                  borderRadius: '10px',
                  background: '#fff',
                  color: BRAND.inkSoft,
                  fontSize: '13.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={disconnectAccount}
                disabled={disconnecting}
                style={{
                  height: '38px',
                  padding: '0 16px',
                  border: 'none',
                  borderRadius: '10px',
                  background: BRAND.dangerStrong,
                  color: '#fff',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  cursor: disconnecting ? 'default' : 'pointer',
                }}
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast message={toast} />
    </div>
  );
}
