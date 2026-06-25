'use client';
import { useState } from 'react';
import type { MerchantData } from '../../lib';

const card: React.CSSProperties = {
  background: 'var(--c-white)',
  borderRadius: 14,
  border: '1px solid var(--c-merchant-border)',
  padding: '28px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
};

export function ApiKeysContent({ data }: { data: MerchantData }) {
  const [copied, setCopied] = useState(false);

  const embedCode = `<!-- Wrap each product with this markup -->
<div class="product">
  <img src="https://example.com/images/product.png"
       data-id="100"
       data-category="saree"
       alt="Product Image">
  <button class="tryon-btn">Try On</button>
</div>

<!-- Paste before </body> -->
<script>
  window.AIVASTRA_WIDGET = { widget_key: "${data.widgetKey}" };
</script>
<script src="https://app.aivastra.com/widget/loader.js"></script>`;

  function copy() {
    navigator.clipboard.writeText(embedCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const detailLabel: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--c-merchant-text-placeholder)',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    margin: '0 0 5px',
  };

  return (
    <>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-text)', margin: '0 0 4px' }}>
          Your Try-On Widget
        </h1>
        <p style={{ fontSize: 14, color: 'var(--c-merchant-text-placeholder)', margin: 0 }}>
          Copy the embed code and paste it into your website.
        </p>
      </div>

      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}
      >
        {/* Left — code */}
        <div style={card}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)', margin: '0 0 8px' }}>
            Embed Code
          </h3>
          <p
            style={{
              fontSize: 13,
              color: 'var(--c-merchant-text-placeholder)',
              margin: '0 0 16px',
              lineHeight: 1.6,
            }}
          >
            Paste this before the{' '}
            <code
              style={{
                background: 'var(--c-merchant-hover)',
                padding: '1px 6px',
                borderRadius: 4,
                fontSize: 12,
                color: 'var(--c-merchant-text-secondary)',
              }}
            >
              &lt;/body&gt;
            </code>{' '}
            tag on your website.
          </p>
          <pre
            style={{
              background: 'var(--c-merchant-code-bg)',
              border: '1px solid var(--c-merchant-border)',
              borderRadius: 10,
              padding: '18px 20px',
              fontSize: 12.5,
              fontFamily: 'monospace',
              color: 'var(--c-merchant-text-secondary)',
              overflow: 'auto',
              margin: '0 0 16px',
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {embedCode}
          </pre>
          <button
            type="button"
            onClick={copy}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--c-merchant-accent)',
              color: 'var(--c-white)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {copied ? '✓ Copied!' : 'Copy Code'}
          </button>
        </div>

        {/* Right — Account Status */}
        <div style={card}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)', margin: '0 0 20px' }}>
            Account Status
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <p style={detailLabel}>Widget</p>
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
              <p
                style={{
                  fontSize: 12,
                  color: 'var(--c-merchant-text-placeholder)',
                  margin: '8px 0 0',
                  lineHeight: 1.6,
                }}
              >
                {data.isActive
                  ? 'Your widget is active and ready to use.'
                  : 'Widget is currently inactive. Our admin team will contact you soon.'}
              </p>
            </div>
            <div style={{ height: 1, background: 'var(--c-merchant-hover)' }} />
            <div>
              <p style={detailLabel}>Widget Key</p>
              <code
                style={{
                  fontSize: 11,
                  color: 'var(--c-merchant-text-muted)',
                  wordBreak: 'break-all',
                  lineHeight: 1.6,
                }}
              >
                {data.widgetKey}
              </code>
            </div>
            <div>
              <p style={detailLabel}>Domain</p>
              <p style={{ fontSize: 13, color: 'var(--c-merchant-text-secondary)', margin: 0 }}>
                {data.websiteUrl || '—'}
              </p>
            </div>
            <div>
              <p style={detailLabel}>Plan</p>
              <span
                style={{
                  display: 'inline-block',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--c-merchant-accent)',
                  background: 'var(--c-merchant-accent-tint)',
                  padding: '4px 12px',
                  borderRadius: 20,
                }}
              >
                Free Trial
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
