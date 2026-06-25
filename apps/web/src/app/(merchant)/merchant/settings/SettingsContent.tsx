'use client';
import { useState } from 'react';
import { PremiumSelect } from '@/components/ui/premium-select';
import type { MerchantData } from '../../lib';

const ACCENT_HEX = '#7c5cfc';
const WHITE_HEX = '#ffffff';

type Position = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
const POSITION_LABELS: Record<Position, string> = {
  'bottom-right': 'Bottom Right',
  'bottom-left': 'Bottom Left',
  'top-right': 'Top Right',
  'top-left': 'Top Left',
};
const LABEL_TO_POSITION = Object.fromEntries(
  Object.entries(POSITION_LABELS).map(([k, v]) => [v, k as Position]),
) as Record<string, Position>;

const card: React.CSSProperties = {
  background: 'var(--c-white)',
  borderRadius: 14,
  border: '1px solid var(--c-merchant-border)',
  padding: '28px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  marginBottom: 20,
};

const fieldLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--c-merchant-text-secondary)',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid var(--c-merchant-input-border)',
  fontSize: 13,
  color: 'var(--c-merchant-text-secondary)',
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
  background: 'var(--c-white)',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--c-text)',
  margin: '0 0 6px',
};

const sectionDesc: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--c-merchant-text-placeholder)',
  margin: '0 0 22px',
};

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: 42,
        height: 22,
        borderRadius: 11,
        border: 'none',
        background: checked ? 'var(--c-merchant-accent)' : 'var(--c-merchant-input-border)',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 22 : 2,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'var(--c-white)',
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        }}
      />
    </button>
  );
}

export function SettingsContent({ data }: { data: MerchantData }) {
  const s = data.settings ?? {};
  const [widgetName, setWidgetName] = useState(s.widgetName ?? 'AI Vastra Widget');
  const [position, setPosition] = useState<string>(POSITION_LABELS[s.position ?? 'bottom-right']);
  const [primaryColor, setPrimaryColor] = useState(s.primaryColor ?? ACCENT_HEX);
  const [buttonColor, setButtonColor] = useState(s.buttonColor ?? ACCENT_HEX);
  const [bgColor, setBgColor] = useState(s.bgColor ?? WHITE_HEX);
  const [borderRadius, setBorderRadius] = useState(String(s.borderRadius ?? 8));
  const [shadow, setShadow] = useState(s.shadow ?? true);
  const [minSize, setMinSize] = useState(String(s.minSizeMb ?? 1));
  const [maxSize, setMaxSize] = useState(String(s.maxSizeMb ?? 5));
  const [cameraUpload, setCameraUpload] = useState(s.cameraUpload ?? false);
  const [domains, setDomains] = useState((data.allowedOrigins ?? []).join('\n'));
  const [customCss, setCustomCss] = useState(s.customCss ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true);
    setError('');
    try {
      const allowedOrigins = domains
        .split('\n')
        .map((d) => d.trim())
        .filter(Boolean);
      const res = await fetch('/api/merchant/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            widgetName: widgetName.trim(),
            position: LABEL_TO_POSITION[position] ?? 'bottom-right',
            primaryColor,
            buttonColor,
            bgColor,
            borderRadius: Number(borderRadius) || 0,
            shadow,
            minSizeMb: Number(minSize) || 0,
            maxSizeMb: Number(maxSize) || 0,
            cameraUpload,
            customCss,
          },
          allowedOrigins,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err?.error?.message ?? 'Could not save settings. Please try again.');
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const field = (lbl: string, hint: string | undefined, children: React.ReactNode) => (
    <div style={{ marginBottom: 18 }}>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: visual label only, input is passed as children */}
      <label style={fieldLabel}>{lbl}</label>
      {hint && (
        <p style={{ fontSize: 12, color: 'var(--c-merchant-text-placeholder)', margin: '0 0 6px' }}>
          {hint}
        </p>
      )}
      {children}
    </div>
  );

  const toggleRow = (lbl: string, hint: string, val: boolean, set: (v: boolean) => void) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 0',
        marginBottom: 18,
      }}
    >
      <div>
        <p style={{ ...fieldLabel, marginBottom: 2 }}>{lbl}</p>
        <p style={{ fontSize: 12, color: 'var(--c-merchant-text-placeholder)', margin: 0 }}>
          {hint}
        </p>
      </div>
      <Toggle checked={val} onChange={set} />
    </div>
  );

  return (
    <>
      <div
        style={{
          marginBottom: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-text)', margin: '0 0 4px' }}>
            Settings
          </h1>
          <p style={{ fontSize: 14, color: 'var(--c-merchant-text-placeholder)', margin: 0 }}>
            Configure your widget behaviour and appearance.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{
            padding: '10px 24px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--c-merchant-accent)',
            color: 'var(--c-white)',
            fontSize: 13,
            fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1,
            fontFamily: 'inherit',
          }}
        >
          {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Changes'}
        </button>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 20,
            padding: '12px 16px',
            borderRadius: 8,
            background: 'var(--c-merchant-danger-tint)',
            color: 'var(--c-merchant-danger)',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {error}
        </div>
      )}

      <div style={card}>
        <h3 style={sectionTitle}>General Settings</h3>
        <p style={sectionDesc}>Basic configuration for your try-on widget.</p>
        {field(
          'Widget Name',
          undefined,
          <input
            style={inputStyle}
            value={widgetName}
            onChange={(e) => setWidgetName(e.target.value)}
          />,
        )}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 0',
            marginBottom: 18,
          }}
        >
          <div>
            <p style={{ ...fieldLabel, marginBottom: 2 }}>Widget Status</p>
            <p style={{ fontSize: 12, color: 'var(--c-merchant-text-placeholder)', margin: 0 }}>
              Activation is managed by our team. Contact support to change it.
            </p>
          </div>
          <span
            style={{
              display: 'inline-block',
              fontSize: 12,
              fontWeight: 600,
              padding: '4px 12px',
              borderRadius: 20,
              color: data.isActive ? 'var(--c-merchant-success)' : 'var(--c-merchant-danger)',
              background: data.isActive
                ? 'var(--c-merchant-success-tint)'
                : 'var(--c-merchant-danger-tint)',
            }}
          >
            {data.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
        {field(
          'Button Position',
          undefined,
          <div
            style={{
              ...inputStyle,
              display: 'flex',
              alignItems: 'center',
              padding: 0,
              height: 34,
              cursor: 'pointer',
            }}
          >
            <PremiumSelect
              value={position}
              onChange={(v) => setPosition(String(v))}
              fullWidth
              height={32}
              fontSize={13}
              options={Object.values(POSITION_LABELS).map((l) => ({ value: l, label: l }))}
            />
          </div>,
        )}
      </div>

      <div style={card}>
        <h3 style={sectionTitle}>Design Settings</h3>
        <p style={sectionDesc}>Customise the look and feel of the widget.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 24px' }}>
          {[
            { lbl: 'Primary Color', val: primaryColor, set: setPrimaryColor },
            { lbl: 'Button Color', val: buttonColor, set: setButtonColor },
            { lbl: 'Background Color', val: bgColor, set: setBgColor },
          ].map(({ lbl, val, set }) =>
            field(
              lbl,
              undefined,
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="color"
                  value={val}
                  onChange={(e) => set(e.target.value)}
                  style={{
                    width: 38,
                    height: 36,
                    borderRadius: 6,
                    border: '1px solid var(--c-merchant-input-border)',
                    cursor: 'pointer',
                    padding: 2,
                    background: 'none',
                  }}
                />
                <input
                  value={val}
                  onChange={(e) => set(e.target.value)}
                  style={{ ...inputStyle, width: 110 }}
                />
              </div>,
            ),
          )}
        </div>
        {field(
          'Border Radius (px)',
          undefined,
          <input
            type="number"
            style={{ ...inputStyle, width: 90 }}
            value={borderRadius}
            onChange={(e) => setBorderRadius(e.target.value)}
          />,
        )}
        {toggleRow('Enable Shadow', 'Add a drop shadow to the widget button', shadow, setShadow)}
      </div>

      <div style={card}>
        <h3 style={sectionTitle}>Upload Settings</h3>
        <p style={sectionDesc}>Control image upload constraints for end users.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
          {field(
            'Minimum Image Size (MB)',
            undefined,
            <input
              type="number"
              style={{ ...inputStyle }}
              value={minSize}
              onChange={(e) => setMinSize(e.target.value)}
              min="0"
              step="0.1"
            />,
          )}
          {field(
            'Maximum Image Size (MB)',
            undefined,
            <input
              type="number"
              style={{ ...inputStyle }}
              value={maxSize}
              onChange={(e) => setMaxSize(e.target.value)}
              min="1"
              step="0.5"
            />,
          )}
        </div>
        {toggleRow(
          'Enable Camera Upload',
          'Let users take photos directly from their device camera',
          cameraUpload,
          setCameraUpload,
        )}
      </div>

      <div style={card}>
        <h3 style={sectionTitle}>Advanced Settings</h3>
        <p style={sectionDesc}>Domain restrictions and custom styling overrides.</p>
        {field(
          'Allowed Domains',
          'One domain per line. Leave blank to allow all.',
          <textarea
            style={{ ...inputStyle, height: 80, resize: 'vertical' }}
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            placeholder="https://yourstore.com"
          />,
        )}
        {field(
          'Custom CSS',
          'Injected directly into the widget iframe.',
          <textarea
            style={{
              ...inputStyle,
              height: 120,
              resize: 'vertical',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
            value={customCss}
            onChange={(e) => setCustomCss(e.target.value)}
            placeholder="/* Your custom styles */"
          />,
        )}
      </div>
    </>
  );
}
