import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function DocumentationPage() {
  const codeBlock = (txt: string) => (
    <pre
      style={{
        background: 'hsl(var(--bg-surface-hover))',
        border: '1px solid hsl(var(--border-default))',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4) var(--space-5)',
        fontSize: '0.875rem',
        fontFamily: 'monospace',
        color: 'hsl(var(--text-secondary))',
        overflow: 'auto',
        margin: 'var(--space-3) 0',
        lineHeight: 1.7,
        whiteSpace: 'pre',
      }}
    >
      {txt}
    </pre>
  );

  const pStyle: React.CSSProperties = {
    fontSize: '0.875rem',
    color: 'hsl(var(--text-secondary))',
    lineHeight: 1.7,
    margin: '0 0 var(--space-3)',
  };

  const liStyle: React.CSSProperties = {
    fontSize: '0.875rem',
    color: 'hsl(var(--text-secondary))',
    lineHeight: 1.7,
    marginBottom: 'var(--space-2)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 900 }}>
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
          Integration Guide
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'hsl(var(--text-secondary))', margin: 0 }}>
          AI Vastrā Try-On Widget — HTML, CSS & JavaScript setup
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Prerequisites</CardTitle>
        </CardHeader>
        <CardContent>
          <ul style={{ paddingLeft: 'var(--space-5)', margin: 0 }}>
            {[
              'A valid Widget Key (from your dashboard)',
              'Publicly accessible product image URL',
              'Product metadata: product_id, category (e.g. Saree)',
            ].map((t) => (
              <li key={t} style={liStyle}>
                {t}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Basic HTML Markup</CardTitle>
        </CardHeader>
        <CardContent>
          <p style={pStyle}>Use the following HTML structure for each product card:</p>
          {codeBlock(`<div class="product">
    <img
        src="https://example.com/images/saree.png"
        data-id="106"
        data-category="saree"
        alt="Product Image">
    <button class="tryon-btn">Try On</button>
</div>`)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Required Widget Scripts</CardTitle>
        </CardHeader>
        <CardContent>
          <p style={{ ...pStyle, color: 'hsl(var(--danger-base))', fontWeight: 500 }}>
            ⚠️ Do not expose your widget key in public repositories.
          </p>
          {codeBlock(`<script>
window.AIVASTRA_WIDGET = {
    widget_key: "YOUR_WIDGET_KEY_HERE"
};
</script>

<script src="https://app.aivastra.com/widget/loader.js"></script>`)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4. JavaScript – Open the Widget</CardTitle>
        </CardHeader>
        <CardContent>
          {codeBlock(`<script>
const DOMAIN = window.location.origin;

function openTryOn(img) {
    window.AIVASTRA_OPEN_WIDGET({
        garment_image: img.src,
        product_id: img.dataset.id,
        category: img.dataset.category,
        domain: DOMAIN
    });
}

document.querySelectorAll('.product').forEach(product => {
    const img = product.querySelector('img');
    const btn = product.querySelector('button');
    img.addEventListener('click', () => openTryOn(img));
    btn.addEventListener('click', () => openTryOn(img));
});
</script>`)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>5. Optional CSS Styling</CardTitle>
        </CardHeader>
        <CardContent>
          {codeBlock(`.product {
    width: 260px;
    border: 1px solid hsl(var(--border-default));
    padding: 12px;
    border-radius: 10px;
    text-align: center;
}
.product img { width: 100%; border-radius: 8px; cursor: pointer; }
.tryon-btn {
    margin-top: 10px;
    background: hsl(var(--accent-primary));
    color: hsl(var(--text-on-accent));
    padding: 8px 16px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
}`)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>6. Supported Categories</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {['Sarees', 'Kurtas', 'Shirts', 'T-Shirts', 'Trousers', 'Dresses'].map((c) => (
              <Badge key={c} variant="primary">
                {c}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>7. Notes & Best Practices</CardTitle>
        </CardHeader>
        <CardContent>
          <ul style={{ paddingLeft: 'var(--space-5)', margin: '0 0 var(--space-4)' }}>
            {[
              'Image size: 1 MB – 3 MB for best results',
              'Recommended image ratio: 4:2',
              'Use HTTPS image URLs only',
              'One widget key per domain',
            ].map((t) => (
              <li key={t} style={liStyle}>
                {t}
              </li>
            ))}
          </ul>
          <p style={{ ...pStyle, marginBottom: 0 }}>
            Need help?{' '}
            <a
              href="mailto:support@aivastra.com"
              style={{
                color: 'hsl(var(--accent-primary))',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              support@aivastra.com &rarr;
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
