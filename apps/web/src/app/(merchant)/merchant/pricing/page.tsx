import Link from 'next/link';
import { formatInr, MERCHANT_PLANS } from './plans';

export default function PricingPage() {
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--c-text)', margin: '0 0 8px' }}>
          Choose Your Plan
        </h1>
        <p style={{ fontSize: 15, color: 'var(--c-merchant-text-placeholder)', margin: 0 }}>
          Flexible pricing built for every stage of growth
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 20,
        }}
      >
        {MERCHANT_PLANS.map((plan) => (
          <div
            key={plan.slug}
            style={{
              background: 'var(--c-white)',
              borderRadius: 16,
              border: plan.featured
                ? '2px solid var(--c-merchant-accent)'
                : '1px solid var(--c-merchant-border)',
              padding: '28px 24px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: plan.featured
                ? '0 8px 32px rgba(124,92,252,0.15)'
                : '0 1px 4px rgba(0,0,0,0.04)',
              position: 'relative',
            }}
          >
            {/* Badge */}
            <span
              style={{
                display: 'inline-block',
                alignSelf: 'flex-start',
                fontSize: 11,
                fontWeight: 700,
                color: plan.badgeColor,
                background: plan.badgeBg,
                padding: '4px 10px',
                borderRadius: 20,
                marginBottom: 18,
                letterSpacing: '0.03em',
              }}
            >
              {plan.badge}
            </span>

            <h2
              style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text)', margin: '0 0 6px' }}
            >
              {plan.name}
            </h2>

            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--c-text)' }}>
                {formatInr(plan.priceInr).replace('.00', '')}
              </span>
              <span
                style={{ fontSize: 13, color: 'var(--c-merchant-text-placeholder)', marginLeft: 3 }}
              >
                /mo
              </span>
            </div>

            <p
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--c-merchant-accent)',
                margin: '0 0 20px',
              }}
            >
              {plan.credits.toLocaleString('en-IN')} Credits
            </p>

            <div style={{ height: 1, background: 'var(--c-merchant-hover)', marginBottom: 20 }} />

            <ul style={{ padding: 0, margin: '0 0 28px', listStyle: 'none', flex: 1 }}>
              {[
                `${plan.validityMonths} Month Validity`,
                `${plan.requestsPerMin} API calls / min`,
                `${formatInr(plan.costPerCredit).replace('.00', '')} per credit`,
                ...plan.benefits.slice(0, 3),
              ].map((f) => (
                <li
                  key={f}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: 'var(--c-merchant-text-muted)',
                    marginBottom: 10,
                  }}
                >
                  <span
                    style={{ color: 'var(--c-merchant-success)', fontWeight: 700, flexShrink: 0 }}
                  >
                    ✓
                  </span>
                  {f}
                </li>
              ))}
            </ul>

            <Link
              href={`/merchant/pricing/${plan.slug}`}
              style={{
                display: 'block',
                textAlign: 'center',
                padding: '11px 20px',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 700,
                textDecoration: 'none',
                background: plan.featured ? 'var(--c-merchant-accent)' : 'transparent',
                color: plan.featured ? 'var(--c-white)' : 'var(--c-merchant-accent)',
                border: plan.featured ? 'none' : '2px solid var(--c-merchant-accent)',
              }}
            >
              Choose Plan
            </Link>
          </div>
        ))}
      </div>

      <p
        style={{
          textAlign: 'center',
          fontSize: 13,
          color: 'var(--c-merchant-text-placeholder)',
          marginTop: 32,
        }}
      >
        Need a custom plan?{' '}
        <a
          href="mailto:sales@aivastra.com"
          style={{ color: 'var(--c-merchant-accent)', fontWeight: 600, textDecoration: 'none' }}
        >
          Talk to our team →
        </a>
      </p>
    </>
  );
}
