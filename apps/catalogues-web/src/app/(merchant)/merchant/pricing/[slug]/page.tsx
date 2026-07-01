import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMerchant } from '../../../lib';
import { formatInr, GST_RATE, getPlan } from '../plans';
import { UpgradeButton } from './UpgradeButton';

export default async function PackageDetailsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireMerchant();
  const { slug } = await params;
  const plan = getPlan(slug);
  if (!plan) notFound();

  const gst = Math.round(plan.priceInr * GST_RATE);
  const total = plan.priceInr + gst;

  const detail = (label: string, value: string) => (
    <div>
      <p
        style={{
          fontSize: 13,
          color: 'var(--c-merchant-text-placeholder)',
          margin: '0 0 4px',
        }}
      >
        {label}
      </p>
      <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text)', margin: 0 }}>{value}</p>
    </div>
  );

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 340px',
        gap: 24,
        alignItems: 'start',
        maxWidth: 1040,
        margin: '0 auto',
      }}
    >
      {/* ── Left: plan details ── */}
      <div
        style={{
          background: 'var(--c-white)',
          borderRadius: 16,
          border: '1px solid var(--c-merchant-border)',
          padding: '32px 36px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--c-text)', margin: '0 0 8px' }}>
          {plan.name} Plan
        </h1>
        <p
          style={{
            fontSize: 14,
            color: 'var(--c-merchant-text-muted)',
            margin: '0 0 28px',
            lineHeight: 1.6,
          }}
        >
          {plan.description}
        </p>

        <div style={{ height: 1, background: 'var(--c-merchant-hover)', marginBottom: 28 }} />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            rowGap: 28,
            columnGap: 24,
            marginBottom: 32,
          }}
        >
          {detail('Total Credits', plan.credits.toLocaleString('en-IN'))}
          {detail('Validity', `${plan.validityMonths} Month${plan.validityMonths > 1 ? 's' : ''}`)}
          {detail('Requests / Minute', String(plan.requestsPerMin))}
          {detail('Cost per Credit', formatInr(plan.costPerCredit).replace('.00', ''))}
        </div>

        <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-text)', margin: '0 0 16px' }}>
          Included Benefits
        </h3>
        <ul style={{ padding: 0, margin: 0, listStyle: 'none' }}>
          {plan.benefits.map((b) => (
            <li
              key={b}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                color: 'var(--c-merchant-text-secondary)',
                marginBottom: 12,
              }}
            >
              <span style={{ color: 'var(--c-merchant-success)', fontWeight: 700, flexShrink: 0 }}>
                ✓
              </span>
              {b}
            </li>
          ))}
        </ul>
      </div>

      {/* ── Right: order summary ── */}
      <div
        style={{
          background: 'var(--c-white)',
          borderRadius: 16,
          border: '1px solid var(--c-merchant-border)',
          padding: '24px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
          position: 'sticky',
          top: 92,
        }}
      >
        <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--c-text)', margin: '0 0 20px' }}>
          Order Summary
        </h3>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 14,
            color: 'var(--c-merchant-text-secondary)',
            marginBottom: 12,
          }}
        >
          <span>{plan.name} Plan</span>
          <span>{formatInr(plan.priceInr)}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 14,
            color: 'var(--c-merchant-text-secondary)',
            marginBottom: 16,
          }}
        >
          <span>GST Included ({Math.round(GST_RATE * 100)}%)</span>
          <span>{formatInr(gst)}</span>
        </div>

        <div style={{ height: 1, background: 'var(--c-merchant-hover)', marginBottom: 16 }} />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 20,
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-text)' }}>Total</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--c-text)' }}>
            {formatInr(total)}
          </span>
        </div>

        <UpgradeButton planSlug={plan.slug} planName={plan.name} />

        <Link
          href="/merchant/pricing"
          style={{
            display: 'block',
            textAlign: 'center',
            marginTop: 14,
            fontSize: 13,
            color: 'var(--c-merchant-accent)',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          ← Back to pricing
        </Link>
      </div>
    </div>
  );
}
