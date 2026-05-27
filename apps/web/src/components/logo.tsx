const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function Logo({ small }: { small?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${BASE}/assets/logo-icon.png`} alt="" style={{ height: small ? 24 : 28, width: 'auto' }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${BASE}/assets/logo-wordmark.png`} alt="Ai Vastra" style={{ height: small ? 20 : 26, width: 'auto', filter: 'brightness(0) invert(1)' }} />
    </div>
  );
}

export function LogoAuth() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${BASE}/assets/logo-icon-large.png`} alt="" style={{ height: 36, width: 'auto' }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${BASE}/assets/logo-wordmark-large.png`} alt="Ai Vastra" style={{ height: 30, width: 'auto' }} />
    </div>
  );
}
