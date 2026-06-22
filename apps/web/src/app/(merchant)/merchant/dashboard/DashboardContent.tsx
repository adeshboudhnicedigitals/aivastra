'use client';
import { ClientJobsTable } from './ClientJobsTable';

interface MerchantData {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  websiteUrl: string;
  widgetKey: string;
  creditBalance: number;
  isActive: boolean;
  createdAt: string;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--c-card)',
  border: '1px solid var(--c-border)',
  borderRadius: 12,
  padding: 24,
};

export function DashboardContent({ data, token }: { data: MerchantData; token: string }) {
  const embedCode = `<script>
  window.AIVASTRA_WIDGET = { widget_key: "${data.widgetKey}" };
</script>
<script src="https://app.aivastra.com/widget/loader.js"></script>`;

  const usageExample = `AIVASTRA_OPEN_WIDGET({ garment_image: "YOUR_PRODUCT_IMAGE_URL" })`;

  return (
    <>
      <h1 style={{ fontWeight: 700, fontSize: 24, color: 'var(--c-text)', marginBottom: 24 }}>
        {data.companyName} Dashboard
      </h1>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          marginBottom: 32,
        }}
      >
        <div style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)', marginBottom: 8 }}>
            Your Widget Key
          </h3>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--c-field)',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              fontFamily: 'monospace',
              color: 'var(--c-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {data.widgetKey}
            </span>
            <button
              style={{
                background: 'var(--c-dark)',
                color: 'var(--c-on-dark)',
                border: 'none',
                borderRadius: 6,
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
              onClick={() => navigator.clipboard.writeText(data.widgetKey)}
            >
              Copy
            </button>
          </div>
        </div>

        <div style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)', marginBottom: 8 }}>
            Embed Code
          </h3>
          <pre
            style={{
              background: 'var(--c-field)',
              borderRadius: 8,
              padding: 12,
              fontSize: 11,
              fontFamily: 'monospace',
              color: 'var(--c-text)',
              overflow: 'auto',
              maxHeight: 120,
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            {embedCode}
          </pre>
          <p style={{ fontSize: 12, color: 'var(--c-mid)', margin: '8px 0' }}>
            Trigger on &quot;Try Now&quot; button:{' '}
            <code style={{ background: 'var(--c-field)', padding: '2px 6px', borderRadius: 4 }}>
              {usageExample}
            </code>
          </p>
          <button
            style={{
              background: 'var(--c-dark)',
              color: 'var(--c-on-dark)',
              border: 'none',
              borderRadius: 6,
              padding: '6px 16px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              marginTop: 8,
            }}
            onClick={() =>
              navigator.clipboard.writeText(`${embedCode}\n\n// Usage:\n${usageExample}`)
            }
          >
            Copy snippet
          </button>
        </div>

        <div style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)', marginBottom: 8 }}>
            Credit Balance
          </h3>
          <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--c-pink)', marginBottom: 12 }}>
            {data.creditBalance ?? 0}
          </div>
          <p style={{ fontSize: 13, color: 'var(--c-mid)', margin: 0 }}>10 credits per try-on</p>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)', marginBottom: 16 }}>
          Recent Jobs
        </h3>
        <ClientJobsTable token={token} />
      </div>
    </>
  );
}
