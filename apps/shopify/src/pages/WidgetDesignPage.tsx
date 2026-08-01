import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Layout,
  Page,
  Tabs,
  Text,
  TextField,
} from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import '../components/widgetPreview.css';
import { type PreviewStep, WidgetPreview } from '../components/WidgetPreview';
import { apiFetch } from '../lib/api';
import {
  normalizeWidgetConfigForSave,
  WIDGET_BEHAVIOR_DEFAULTS,
  WIDGET_COPY_DEFAULTS,
  WIDGET_COPY_FIELDS,
  type WidgetCopyField,
} from '../lib/widgetDefaults';
import type { ShopifyMe, ShopifyWidgetConfig, ShopifyWidgetConfigResponse } from '../types';

const PREVIEW_TABS: { id: PreviewStep; content: string }[] = [
  { id: 'upload', content: 'Upload' },
  { id: 'ready', content: 'Ready' },
  { id: 'generating', content: 'Generating' },
  { id: 'result', content: 'Result' },
  { id: 'error', content: 'Error' },
];

export default function WidgetDesignPage() {
  const [config, setConfig] = useState<ShopifyWidgetConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    apiFetch<ShopifyMe>('/v1/shopify/me')
      .then((me) => setConfig(me.store.settings.widget ?? {}))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const setCopy = useCallback((key: WidgetCopyField, value: string) => {
    setConfig((c) => ({ ...c, copy: { ...c.copy, [key]: value } }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const normalizedConfig = normalizeWidgetConfigForSave(config);
      const res = await apiFetch<ShopifyWidgetConfigResponse>('/v1/shopify/widget-config', {
        method: 'PATCH',
        body: JSON.stringify(normalizedConfig),
      });
      setConfig(res.widget);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [config]);

  const accent = config.theme?.accentColor ?? '';

  return (
    <Page title="Widget Design">
      <Layout>
        <Layout.Section variant="oneHalf">
          <BlockStack gap="400">
            {error && (
              <Banner tone="critical" onDismiss={() => setError(null)}>
                {error}
              </Banner>
            )}

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Theme
                </Text>
                <InlineStack gap="300" blockAlign="center">
                  <input
                    type="color"
                    aria-label="Accent color"
                    value={accent || '#000000'}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, theme: { accentColor: e.target.value } }))
                    }
                  />
                  <Box width="140px">
                    <TextField
                      label="Accent color"
                      labelHidden
                      autoComplete="off"
                      placeholder="#000000"
                      value={accent}
                      onChange={(v) =>
                        setConfig((c) => ({ ...c, theme: { accentColor: v || null } }))
                      }
                    />
                  </Box>
                  <Button
                    onClick={() => setConfig((c) => ({ ...c, theme: { accentColor: null } }))}
                  >
                    Use button color
                  </Button>
                </InlineStack>
                <Text as="p" tone="subdued">
                  Applies to the modal only. Your storefront button keeps the colors set in the
                  theme editor.
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Copy
                </Text>
                {WIDGET_COPY_FIELDS.map((f) => (
                  <TextField
                    key={f.key}
                    label={f.label}
                    autoComplete="off"
                    maxLength={f.max}
                    showCharacterCount
                    placeholder={WIDGET_COPY_DEFAULTS[f.key]}
                    value={config.copy?.[f.key] ?? ''}
                    onChange={(v) => setCopy(f.key, v)}
                  />
                ))}
                <Text as="p" tone="subdued">
                  Leave a field empty to use the default shown in grey.
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Behavior
                </Text>
                <Checkbox
                  label="Show Add to Cart on the result"
                  checked={config.behavior?.addToCart !== false}
                  onChange={(v) =>
                    setConfig((c) => ({ ...c, behavior: { ...c.behavior, addToCart: v } }))
                  }
                />
                <TextField
                  label="Add to Cart label"
                  autoComplete="off"
                  maxLength={30}
                  disabled={config.behavior?.addToCart === false}
                  placeholder={WIDGET_BEHAVIOR_DEFAULTS.addToCartLabel}
                  value={config.behavior?.addToCartLabel ?? ''}
                  onChange={(v) =>
                    setConfig((c) => ({ ...c, behavior: { ...c.behavior, addToCartLabel: v } }))
                  }
                />
                <Checkbox
                  label="Show Share on the result"
                  checked={config.behavior?.share !== false}
                  onChange={(v) =>
                    setConfig((c) => ({ ...c, behavior: { ...c.behavior, share: v } }))
                  }
                />
                <TextField
                  label="Share label"
                  autoComplete="off"
                  maxLength={30}
                  disabled={config.behavior?.share === false}
                  placeholder={WIDGET_BEHAVIOR_DEFAULTS.shareLabel}
                  value={config.behavior?.shareLabel ?? ''}
                  onChange={(v) =>
                    setConfig((c) => ({ ...c, behavior: { ...c.behavior, shareLabel: v } }))
                  }
                />
              </BlockStack>
            </Card>

            <Button variant="primary" loading={saving} disabled={loading} onClick={save}>
              Save
            </Button>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <div className="widget-preview-sticky">
            <Card padding="0">
              <Tabs
                tabs={PREVIEW_TABS.map((t) => ({ id: t.id, content: t.content }))}
                selected={tab}
                onSelect={setTab}
              />
              <Box padding="400">
                <WidgetPreview config={config} step={PREVIEW_TABS[tab].id} />
              </Box>
            </Card>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
