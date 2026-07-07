export function Logo({ small }: { small?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {/* biome-ignore lint/performance/noImgElement: static SVG asset */}
      <img src="/assets/logo.svg" alt="" style={{ height: small ? 24 : 28, width: 'auto' }} />
      {/* biome-ignore lint/performance/noImgElement: static SVG asset */}
      <img
        src="/assets/logo-text.svg"
        alt="Ai Vastra"
        style={{ height: small ? 32 : 38, width: 'auto' }}
      />
    </div>
  );
}

export function LogoAuth() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* biome-ignore lint/performance/noImgElement: static SVG asset */}
      <img src="/assets/logo.svg" alt="" style={{ height: 36, width: 'auto' }} />
      {/* biome-ignore lint/performance/noImgElement: static SVG asset */}
      <img src="/assets/logo-text.svg" alt="Ai Vastra" style={{ height: 30, width: 'auto' }} />
    </div>
  );
}
