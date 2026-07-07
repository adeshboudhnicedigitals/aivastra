'use client';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        border: 'none',
        background: checked ? 'hsl(var(--accent-primary))' : 'hsl(var(--bg-surface-hover))',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.2s',
        flexShrink: 0,
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.1)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 22 : 2,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: 'hsl(var(--text-inverse))',
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
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

  const field = (id: string, lbl: string, hint: string | undefined, children: React.ReactNode) => (
    <div
      key={id}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        marginBottom: 'var(--space-4)',
      }}
    >
      <label
        htmlFor={id}
        style={{ fontSize: '0.875rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}
      >
        {lbl}
      </label>
      {hint && (
        <p
          style={{
            fontSize: '0.75rem',
            color: 'hsl(var(--text-tertiary))',
            margin: '0 0 var(--space-2)',
          }}
        >
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
        padding: 'var(--space-2) 0',
        marginBottom: 'var(--space-4)',
      }}
    >
      <div>
        <p
          style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'hsl(var(--text-secondary))',
            marginBottom: 'var(--space-1)',
          }}
        >
          {lbl}
        </p>
        <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-tertiary))', margin: 0 }}>{hint}</p>
      </div>
      <Toggle checked={val} onChange={set} label={lbl} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 800 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 'var(--space-4)',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 600,
              color: 'hsl(var(--text-primary))',
              letterSpacing: '-0.02em',
              margin: '0 0 var(--space-2)',
            }}
          >
            Settings
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'hsl(var(--text-secondary))', margin: 0 }}>
            Configure your widget behaviour and appearance.
          </p>
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Changes'}
        </Button>
      </div>

      {error && (
        <div
          style={{
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            background: 'hsl(var(--danger-subtle))',
            color: 'hsl(var(--danger-base))',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>General Settings</CardTitle>
          <CardDescription>Basic configuration for your try-on widget.</CardDescription>
        </CardHeader>
        <CardContent>
          {field(
            'widget-name',
            'Widget Name',
            undefined,
            <Input
              id="widget-name"
              value={widgetName}
              onChange={(e) => setWidgetName(e.target.value)}
            />,
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 'var(--space-2) 0',
              marginBottom: 'var(--space-4)',
            }}
          >
            <div>
              <p
                style={{
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: 'hsl(var(--text-secondary))',
                  marginBottom: 'var(--space-1)',
                }}
              >
                Widget Status
              </p>
              <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-tertiary))', margin: 0 }}>
                Activation is managed by our team. Contact support to change it.
              </p>
            </div>
            <Badge variant={data.isActive ? 'success' : 'danger'}>
              {data.isActive ? 'Active' : 'Inactive'}
            </Badge>
          </div>

          {field(
            'button-position',
            'Button Position',
            undefined,
            <select
              id="button-position"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="input input-md"
            >
              {Object.values(POSITION_LABELS).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>,
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Design Settings</CardTitle>
          <CardDescription>Customize the look and feel of the widget.</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 'var(--space-4)',
            }}
          >
            {[
              {
                id: 'primary-color',
                lbl: 'Primary Color',
                val: primaryColor,
                set: setPrimaryColor,
              },
              { id: 'button-color', lbl: 'Button Color', val: buttonColor, set: setButtonColor },
              { id: 'bg-color', lbl: 'Background Color', val: bgColor, set: setBgColor },
            ].map(({ id, lbl, val, set }) =>
              field(
                id,
                lbl,
                undefined,
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <input
                    type="color"
                    aria-label={`${lbl} picker`}
                    value={val}
                    onChange={(e) => set(e.target.value)}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid hsl(var(--border-default))',
                      cursor: 'pointer',
                      padding: 2,
                      background: 'none',
                    }}
                  />
                  <Input
                    id={id}
                    value={val}
                    onChange={(e) => set(e.target.value)}
                    style={{ width: 120 }}
                  />
                </div>,
              ),
            )}
          </div>

          <div style={{ marginTop: 'var(--space-4)' }}>
            {field(
              'border-radius',
              'Border Radius (px)',
              undefined,
              <Input
                id="border-radius"
                type="number"
                style={{ width: 120 }}
                value={borderRadius}
                onChange={(e) => setBorderRadius(e.target.value)}
              />,
            )}
          </div>

          {toggleRow('Enable Shadow', 'Add a drop shadow to the widget button', shadow, setShadow)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upload Settings</CardTitle>
          <CardDescription>Control image upload constraints for end users.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid-responsive-equal-2">
            {field(
              'min-image-size',
              'Minimum Image Size (MB)',
              undefined,
              <Input
                id="min-image-size"
                type="number"
                value={minSize}
                onChange={(e) => setMinSize(e.target.value)}
                min="0"
                step="0.1"
              />,
            )}
            {field(
              'max-image-size',
              'Maximum Image Size (MB)',
              undefined,
              <Input
                id="max-image-size"
                type="number"
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Advanced Settings</CardTitle>
          <CardDescription>Domain restrictions and custom styling overrides.</CardDescription>
        </CardHeader>
        <CardContent>
          {field(
            'allowed-domains',
            'Allowed Domains',
            'One domain per line. Leave blank to allow all.',
            <textarea
              id="allowed-domains"
              className="input input-md"
              style={{ height: 100, resize: 'vertical' }}
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="https://yourstore.com"
            />,
          )}
          {field(
            'custom-css',
            'Custom CSS',
            'Injected directly into the widget iframe.',
            <textarea
              id="custom-css"
              className="input input-md"
              style={{
                height: 140,
                resize: 'vertical',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
              }}
              value={customCss}
              onChange={(e) => setCustomCss(e.target.value)}
              placeholder="/* Your custom styles */"
            />,
          )}
        </CardContent>
      </Card>
    </div>
  );
}
