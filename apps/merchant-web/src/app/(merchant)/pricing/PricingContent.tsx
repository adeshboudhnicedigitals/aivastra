'use client';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import type { MerchantData } from '../../lib';
import { formatInr, MERCHANT_PLANS } from './plans';

export function PricingContent({ data }: { data: MerchantData }) {
  const initials = data.contactName
    ? data.contactName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'M';
  const displayName = data.contactName || data.companyName || 'Merchant';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      {/* ── Header with user avatar and credits ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 'var(--space-4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background:
                'linear-gradient(135deg, hsl(var(--accent-primary)), hsl(var(--accent-primary) / 0.7))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'hsl(var(--text-inverse))',
              fontSize: '1.25rem',
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {initials}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <h1
              style={{
                fontSize: '1.25rem',
                fontWeight: 600,
                color: 'hsl(var(--text-primary))',
                margin: 0,
                lineHeight: 1.2,
              }}
            >
              {displayName}
            </h1>
            <p style={{ fontSize: '0.875rem', color: 'hsl(var(--text-tertiary))', margin: 0 }}>
              {data.email}
            </p>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            background: 'hsl(var(--accent-subtle))',
            border: '1px solid hsl(var(--accent-muted))',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-4)',
          }}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="hsl(var(--accent-primary))"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="hsl(var(--accent-primary))"
              strokeWidth="2"
              fill="none"
            />
            <path
              d="M12 6v6l4 2"
              stroke="hsl(var(--accent-primary))"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <span
            style={{ fontSize: '0.875rem', fontWeight: 600, color: 'hsl(var(--accent-primary))' }}
          >
            {data.creditBalance.toLocaleString('en-IN')} credits
          </span>
        </div>
      </div>

      {/* ── Page title ── */}
      <div style={{ textAlign: 'center', padding: 'var(--space-4) 0' }}>
        <h2
          style={{
            fontSize: '2rem',
            fontWeight: 700,
            color: 'hsl(var(--text-primary))',
            letterSpacing: '-0.02em',
            margin: '0 0 var(--space-2)',
          }}
        >
          Choose Your Plan
        </h2>
        <p style={{ fontSize: '1rem', color: 'hsl(var(--text-secondary))', margin: 0 }}>
          Flexible pricing built for every stage of growth
        </p>
      </div>

      {/* ── Plans grid ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 'var(--space-6)',
          alignItems: 'stretch',
        }}
      >
        {MERCHANT_PLANS.map((plan) => (
          <Card
            key={plan.slug}
            style={{
              position: 'relative',
              borderColor: plan.featured
                ? 'hsl(var(--accent-primary))'
                : 'hsl(var(--border-default))',
              borderWidth: plan.featured ? 2 : 1,
              boxShadow: plan.featured
                ? '0 8px 24px -4px hsl(var(--accent-primary) / 0.15)'
                : 'var(--shadow-sm)',
              display: 'flex',
              flexDirection: 'column',
              transform: plan.featured ? 'translateY(-4px)' : 'none',
            }}
          >
            <CardHeader style={{ paddingBottom: 'var(--space-4)' }}>
              {plan.badge && (
                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      color: plan.badgeColor,
                      background: plan.badgeBg,
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {plan.badge}
                  </span>
                </div>
              )}

              <h3
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 600,
                  color: 'hsl(var(--text-primary))',
                  margin: '0 0 var(--space-1)',
                }}
              >
                {plan.name}
              </h3>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-1)' }}>
                <span
                  style={{
                    fontSize: '2rem',
                    fontWeight: 700,
                    color: 'hsl(var(--text-primary))',
                    letterSpacing: '-0.03em',
                  }}
                >
                  {formatInr(plan.priceInr).replace('.00', '')}
                </span>
                <span style={{ fontSize: '0.875rem', color: 'hsl(var(--text-tertiary))' }}>
                  /mo
                </span>
              </div>

              <p
                style={{
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: 'hsl(var(--accent-primary))',
                  margin: 'var(--space-2) 0 0',
                }}
              >
                {plan.credits.toLocaleString('en-IN')} Credits
              </p>
            </CardHeader>

            <div
              style={{
                margin: '0 var(--space-6)',
                height: 1,
                background: 'hsl(var(--border-subtle))',
              }}
            />

            <CardContent style={{ paddingTop: 'var(--space-5)', flex: 1 }}>
              <ul
                style={{
                  padding: 0,
                  margin: 0,
                  listStyle: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                }}
              >
                {[
                  `${plan.validityMonths} Month Validity`,
                  `${plan.requestsPerMin} API calls / min`,
                  `${formatInr(plan.costPerCredit).replace('.00', '')} per credit`,
                  ...plan.benefits.slice(0, 3),
                ].map((f, i) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: static list, no reorder
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 'var(--space-2)',
                      fontSize: '0.875rem',
                      color: 'hsl(var(--text-secondary))',
                    }}
                  >
                    <Check
                      size={16}
                      strokeWidth={3}
                      color="hsl(var(--success-base))"
                      style={{ flexShrink: 0, marginTop: 2 }}
                    />
                    <span style={{ lineHeight: 1.4 }}>{f}</span>
                  </li>
                ))}
              </ul>
            </CardContent>

            <CardFooter>
              <Link href={`/pricing/${plan.slug}`} style={{ width: '100%' }}>
                <Button variant={plan.featured ? 'default' : 'outline'} style={{ width: '100%' }}>
                  Choose Plan
                </Button>
              </Link>
            </CardFooter>
          </Card>
        ))}
      </div>

      <div style={{ textAlign: 'center', paddingTop: 'var(--space-4)' }}>
        <p style={{ fontSize: '0.875rem', color: 'hsl(var(--text-tertiary))' }}>
          Need a custom plan?{' '}
          <a
            href="mailto:sales@aivastra.com"
            style={{ color: 'hsl(var(--accent-primary))', fontWeight: 500, textDecoration: 'none' }}
          >
            Talk to our team &rarr;
          </a>
        </p>
      </div>
    </div>
  );
}
