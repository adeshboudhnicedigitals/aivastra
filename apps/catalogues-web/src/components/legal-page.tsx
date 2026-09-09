import Link from 'next/link';
import { C } from '@/components/tokens';

export function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 96px' }}>
        <Link
          href="/"
          style={{
            fontSize: 13,
            color: C.mid,
            textDecoration: 'none',
            display: 'inline-block',
            marginBottom: 24,
          }}
        >
          &larr; Ai Vastra
        </Link>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: C.text, margin: '0 0 8px' }}>{title}</h1>
        <p style={{ fontSize: 13, color: C.mid, margin: '0 0 40px' }}>
          Last updated: {lastUpdated}
        </p>
        <div
          style={{
            fontSize: 15,
            lineHeight: 1.7,
            color: C.text,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: '0 0 12px' }}>
        {heading}
      </h2>
      <div style={{ color: C.mid }}>{children}</div>
    </section>
  );
}
