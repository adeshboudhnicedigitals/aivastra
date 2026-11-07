const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function LogoAuth() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* biome-ignore lint/performance/noImgElement: auth logo SVG */}
      <img src={`${BASE}/assets/logo.svg`} alt="" style={{ height: 32, width: 'auto' }} />
      {/* biome-ignore lint/performance/noImgElement: auth logo text SVG */}
      <img
        src={`${BASE}/assets/logo-text.svg`}
        alt="Ai Vastra"
        style={{ height: 34, width: 'auto' }}
      />
    </div>
  );
}
