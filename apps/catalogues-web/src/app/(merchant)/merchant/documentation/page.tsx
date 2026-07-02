export default function DocumentationPage() {
  const card: React.CSSProperties = {
    background: 'var(--c-white)',
    borderRadius: 14,
    border: '1px solid var(--c-merchant-border)',
    padding: '28px 32px',
    marginBottom: 16,
    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  };

  const codeBlock = (txt: string) => (
    <pre
      style={{
        background: 'var(--c-merchant-code-bg)',
        border: '1px solid var(--c-merchant-border)',
        borderRadius: 10,
        padding: '16px 20px',
        fontSize: 12.5,
        fontFamily: 'monospace',
        color: 'var(--c-merchant-text-secondary)',
        overflow: 'auto',
        margin: '12px 0',
        lineHeight: 1.7,
        whiteSpace: 'pre',
      }}
    >
      {txt}
    </pre>
  );

  const h2: React.CSSProperties = {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--c-text)',
    margin: '0 0 10px',
  };
  const p: React.CSSProperties = {
    fontSize: 14,
    color: 'var(--c-merchant-text-muted)',
    lineHeight: 1.7,
    margin: '0 0 10px',
  };
  const li: React.CSSProperties = {
    fontSize: 14,
    color: 'var(--c-merchant-text-muted)',
    lineHeight: 1.7,
    marginBottom: 6,
  };

  return (
    <>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-text)', margin: '0 0 4px' }}>
          Integration Guide
        </h1>
        <p style={{ fontSize: 14, color: 'var(--c-merchant-text-placeholder)', margin: 0 }}>
          AI Vastrā Try-On Widget — HTML, CSS &amp; JavaScript setup
        </p>
      </div>

      <div style={card}>
        <h2 style={h2}>1. Prerequisites</h2>
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          {[
            'A valid Widget Key (from your dashboard)',
            'Publicly accessible product image URL',
            'Product metadata: product_id, category (e.g. Saree)',
          ].map((t) => (
            <li key={t} style={li}>
              {t}
            </li>
          ))}
        </ul>
      </div>

      <div style={card}>
        <h2 style={h2}>2. Basic HTML Markup</h2>
        <p style={p}>Use the following HTML structure for each product card:</p>
        {codeBlock(`<div class="product">
    <img
        src="https://example.com/images/saree.png"
        data-id="106"
        data-category="saree"
        alt="Product Image">
    <button class="tryon-btn">Try On</button>
</div>`)}
      </div>

      <div style={card}>
        <h2 style={h2}>3. Required Widget Scripts</h2>
        <p style={{ ...p, color: 'var(--c-merchant-danger)', fontWeight: 500 }}>
          ⚠️ Do not expose your widget key in public repositories.
        </p>
        {codeBlock(`<script>
window.AIVASTRA_WIDGET = {
    widget_key: "YOUR_WIDGET_KEY_HERE"
};
</script>

<script src="https://app.aivastra.com/widget/loader.js"></script>`)}
      </div>

      <div style={card}>
        <h2 style={h2}>4. JavaScript – Open the Widget</h2>
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
      </div>

      <div style={card}>
        <h2 style={h2}>5. Optional CSS Styling</h2>
        {codeBlock(`.product {
    width: 260px;
    border: 1px solid #eee;
    padding: 12px;
    border-radius: 10px;
    text-align: center;
}
.product img { width: 100%; border-radius: 8px; cursor: pointer; }
.tryon-btn {
    margin-top: 10px;
    background: #7c5cfc;
    color: #fff;
    padding: 8px 16px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
}`)}
      </div>

      <div style={card}>
        <h2 style={h2}>6. Supported Categories</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {['Sarees', 'Kurtas', 'Shirts', 'T-Shirts', 'Trousers', 'Dresses'].map((c) => (
            <span
              key={c}
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--c-merchant-accent)',
                background: 'var(--c-merchant-accent-tint)',
                padding: '5px 14px',
                borderRadius: 20,
              }}
            >
              {c}
            </span>
          ))}
        </div>
      </div>

      <div style={card}>
        <h2 style={h2}>7. Notes &amp; Best Practices</h2>
        <ul style={{ paddingLeft: 20, margin: '0 0 16px' }}>
          {[
            'Image size: 1 MB – 3 MB for best results',
            'Recommended image ratio: 4:2',
            'Use HTTPS image URLs only',
            'One widget key per domain',
          ].map((t) => (
            <li key={t} style={li}>
              {t}
            </li>
          ))}
        </ul>
        <p style={{ ...p, marginBottom: 0 }}>
          Need help?{' '}
          <a
            href="mailto:support@aivastra.com"
            style={{ color: 'var(--c-merchant-accent)', fontWeight: 600, textDecoration: 'none' }}
          >
            support@aivastra.com →
          </a>
        </p>
      </div>
    </>
  );
}
