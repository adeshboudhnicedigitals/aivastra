'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { MerchantData } from '../../lib';

export function ApiKeysContent({ data }: { data: MerchantData }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  const embedCode = `<!-- Paste before </body> -->
<script>
  window.AIVASTRA_WIDGET = { widget_key: "${data.widgetKey}" };
</script>
<script src="https://app.aivastra.com/widget/loader.js"></script>`;

  function copy() {
    navigator.clipboard.writeText(embedCode).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  async function handleRegenerate() {
    setRegenerating(true);
    setError('');
    try {
      const res = await fetch('/api/merchant/api-keys/regenerate', { method: 'POST' });
      if (!res.ok) {
        setError('Failed to regenerate widget key. Please try again.');
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError('Network error while regenerating widget key.');
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
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
          Widget Embed
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'hsl(var(--text-secondary))', margin: 0 }}>
          The live embed continues loading from app.aivastra.com/widget/loader.js.
        </p>
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

      <div className="grid-responsive-2">
        <Card>
          <CardHeader
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <CardTitle>Embed Snippet</CardTitle>
              <CardDescription>Copy this code into your website's HTML</CardDescription>
            </div>
            <Button onClick={copy} variant={copied ? 'secondary' : 'primary'} size="sm">
              {copied ? 'Copied!' : 'Copy Snippet'}
            </Button>
          </CardHeader>
          <CardContent>
            <pre
              style={{
                margin: 0,
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: 'hsl(var(--bg-surface-hover))',
                border: '1px solid hsl(var(--border-default))',
                fontSize: '0.875rem',
                lineHeight: 1.6,
                color: 'hsl(var(--text-secondary))',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'monospace',
              }}
            >
              {embedCode}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Widget Key</CardTitle>
          </CardHeader>
          <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div>
              <div
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'hsl(var(--text-tertiary))',
                  textTransform: 'uppercase',
                  marginBottom: 'var(--space-2)',
                }}
              >
                Current Key
              </div>
              <code
                style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  lineHeight: 1.6,
                  color: 'hsl(var(--text-primary))',
                  wordBreak: 'break-all',
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: 'hsl(var(--bg-surface-hover))',
                  border: '1px solid hsl(var(--border-default))',
                  fontFamily: 'monospace',
                }}
              >
                {data.widgetKey}
              </code>
            </div>

            <div
              style={{
                paddingTop: 'var(--space-5)',
                borderTop: '1px solid hsl(var(--border-subtle))',
              }}
            >
              <div
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'hsl(var(--text-tertiary))',
                  textTransform: 'uppercase',
                  marginBottom: 'var(--space-2)',
                }}
              >
                Kiosk Access
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <Badge variant={data.kioskEnabled ? 'success' : 'secondary'}>
                  {data.kioskEnabled ? 'Enabled' : 'Disabled'}
                </Badge>
                <span style={{ fontSize: '0.875rem', color: 'hsl(var(--text-secondary))' }}>
                  Max devices: {data.maxKioskDevices}
                </span>
              </div>
            </div>

            <div
              style={{
                paddingTop: 'var(--space-5)',
                borderTop: '1px solid hsl(var(--border-subtle))',
              }}
            >
              {!confirming ? (
                <Button variant="destructive" onClick={() => setConfirming(true)}>
                  Regenerate Widget Key
                </Button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <div
                    style={{
                      fontSize: '0.875rem',
                      color: 'hsl(var(--danger-base))',
                      fontWeight: 500,
                    }}
                  >
                    Regenerating the key breaks every existing live embed until the snippet is
                    updated.
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <Button variant="outline" onClick={() => setConfirming(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={regenerating}
                      onClick={() => void handleRegenerate()}
                    >
                      {regenerating ? 'Regenerating...' : 'Confirm Regeneration'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
