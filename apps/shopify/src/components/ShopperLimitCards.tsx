import { BlockStack, Card, Select, Text } from '@shopify/polaris';
import type { ReactNode } from 'react';
import {
  EMAIL_AFTER_N_OPTIONS,
  numericLimitPatch,
  numericOptions,
  OFF,
  PER_SHOPPER_CAP_OPTIONS,
  PRESELECTED,
} from '../lib/limits';
import type { ShopifyStoreLimits } from '../types';

// The per-shopper and ask-for-email settings, shared by Settings → Limits and
// onboarding's limits step so the two can never drift apart. Each card edits
// a draft: `onChange` receives just the keys that changed.
interface CardProps {
  limits: ShopifyStoreLimits;
  onChange: (patch: Partial<ShopifyStoreLimits>) => void;
  /** Drop the bordered Card and render the content on the bare page (onboarding). */
  bare?: boolean;
}

function Section({ bare, children }: { bare?: boolean; children: ReactNode }) {
  return bare ? children : <Card>{children}</Card>;
}

export function PerShopperLimitCard({ limits, onChange, bare }: CardProps) {
  return (
    <Section bare={bare}>
      <BlockStack gap="300">
        <Text
          as="h2"
          variant={bare ? 'headingLg' : 'headingMd'}
          fontWeight={bare ? 'bold' : undefined}
        >
          Per-shopper limit
        </Text>
        <Text as="p" tone="subdued">
          Reduces casual overuse by one shopper. Treat it as friction, not as a spend guarantee — a
          shopper who clears their browser storage gets a fresh allowance. Set a store daily limit
          as well if you want a hard ceiling.
        </Text>
        <Select
          label="Try-ons per shopper"
          options={numericOptions(PER_SHOPPER_CAP_OPTIONS, 'No limit', (n) => String(n))}
          value={limits.perShopperCap == null ? OFF : String(limits.perShopperCap)}
          onChange={(v) =>
            onChange(numericLimitPatch('perShopperCap', v, PRESELECTED.perShopperCap))
          }
        />
        <Select
          label="Resets every"
          options={[
            { label: 'Day', value: 'day' },
            { label: 'Week', value: 'week' },
            { label: 'Month', value: 'month' },
          ]}
          value={limits.perShopperWindow ?? 'week'}
          onChange={(v) => onChange({ perShopperWindow: v as 'day' | 'week' | 'month' })}
          disabled={limits.perShopperCap == null}
        />
      </BlockStack>
    </Section>
  );
}

export function AskForEmailCard({ limits, onChange, bare }: CardProps) {
  return (
    <Section bare={bare}>
      <BlockStack gap="300">
        <Text
          as="h2"
          variant={bare ? 'headingLg' : 'headingMd'}
          fontWeight={bare ? 'bold' : undefined}
        >
          Ask for an email
        </Text>
        <Text as="p" tone="subdued">
          After this many try-ons, shoppers are asked for their email before continuing. Collected
          addresses appear on the Analytics page.
        </Text>
        <Select
          label="Ask after"
          options={numericOptions(EMAIL_AFTER_N_OPTIONS, 'Never ask', (n) =>
            n === 0 ? 'Before the first try-on' : `${n} try-on${n === 1 ? '' : 's'}`,
          )}
          value={limits.emailAfterNTryOns == null ? OFF : String(limits.emailAfterNTryOns)}
          onChange={(v) =>
            onChange(numericLimitPatch('emailAfterNTryOns', v, PRESELECTED.emailAfterNTryOns))
          }
        />
      </BlockStack>
    </Section>
  );
}
