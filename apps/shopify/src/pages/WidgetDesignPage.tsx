import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  ContextualSaveBar,
  InlineStack,
  Layout,
  Modal,
  Page,
  Tabs,
  Text,
  TextField,
} from '@shopify/polaris';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../components/widgetPreview.css';
import { type PreviewStep, WidgetPreview } from '../components/WidgetPreview';
import { apiFetch } from '../lib/api';
import { setNavGuard } from '../lib/navGuard';
import {
  createWidgetConfigPatch,
  rebaseWidgetConfigAfterSave,
  WIDGET_BEHAVIOR_DEFAULTS,
  WIDGET_COPY_DEFAULTS,
  WIDGET_COPY_FIELDS,
  type WidgetCopyField,
  widgetConfigsEqual,
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
  const [saved, setSaved] = useState<ShopifyWidgetConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(true);
  const [republishing, setRepublishing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    apiFetch<ShopifyMe>('/v1/shopify/me')
      .then((me) => {
        const w = me.store.settings.widget ?? {};
        setConfig(w);
        setSaved(w);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Structural compare, not reference: editing a field and undoing the edit
  // must clear the save bar rather than leave it stuck open.
  const dirty = useMemo(() => !widgetConfigsEqual(config, saved), [config, saved]);

  const setCopy = useCallback((key: WidgetCopyField, value: string) => {
    setConfig((c) => ({ ...c, copy: { ...c.copy, [key]: value } }));
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    const submittedConfig = config;
    const patch = createWidgetConfigPatch(submittedConfig, saved);
    try {
      const res = await apiFetch<ShopifyWidgetConfigResponse>('/v1/shopify/widget-config', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      // The Shopify call can take up to ten seconds. Rebase any edits (or a
      // discard) made during that window rather than replacing them with the
      // request's response snapshot.
      setConfig((current) => rebaseWidgetConfigAfterSave(current, submittedConfig, res.widget));
      setSaved(res.widget);
      setSynced(res.synced);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }, [config, saved]);

  const discard = useCallback(() => setConfig(saved), [saved]);

  const republish = useCallback(async () => {
    setRepublishing(true);
    setError(null);
    try {
      const res = await apiFetch<{ synced: boolean }>('/v1/shopify/widget-config/republish', {
        method: 'POST',
      });
      setSynced(res.synced);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRepublishing(false);
    }
  }, []);

  // Register the guard while this page is mounted. Returning false abandons the
  // navigation outright and opens the modal — the merchant re-clicks the nav
  // item after deciding. Deliberately not queuing and replaying the pending
  // navigation: the guard is called from two different call sites with no
  // shared notion of "the navigation that was attempted", and a stale queued
  // target is worse than a second click.
  //
  // A ref, not `dirty` in the dep array: re-registering the guard on every
  // keystroke would race with a nav click landing between unregister and
  // register.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    setNavGuard(() => {
      if (!dirtyRef.current) return true;
      setBlocked(true);
      return false;
    });
    return () => setNavGuard(null);
  }, []);

  // App Bridge's save bar lives in the admin's own top chrome, outside this
  // iframe, so it is shown imperatively rather than by rendering.
  useEffect(() => {
    const bar = window.shopify?.saveBar;
    if (!bar) return;
    if (dirty) bar.show('widget-design-save').catch(() => {});
    else bar.hide('widget-design-save').catch(() => {});
  }, [dirty]);

  // Covers reload and tab close, which no in-app guard can see.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const accent = config.theme?.accentColor ?? '';

  return (
    <Page title="Widget Design">
      {window.shopify ? (
        <ui-save-bar id="widget-design-save">
          <button
            {...{ variant: 'primary' }}
            aria-busy={saving}
            disabled={loading || saving}
            onClick={save}
            type="button"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={discard} type="button">
            Discard
          </button>
        </ui-save-bar>
      ) : dirty ? (
        <ContextualSaveBar
          message="Unsaved changes"
          saveAction={{ onAction: save, loading: saving, disabled: loading }}
          discardAction={{ onAction: discard }}
        />
      ) : null}

      {blocked && (
        <Modal
          open
          title="You have unsaved changes"
          onClose={() => setBlocked(false)}
          primaryAction={{
            content: 'Save',
            onAction: async () => {
              if (await save()) setBlocked(false);
            },
            loading: saving,
          }}
          secondaryActions={[
            {
              content: 'Discard',
              onAction: () => {
                discard();
                setBlocked(false);
              },
            },
            { content: 'Keep editing', onAction: () => setBlocked(false) },
          ]}
        >
          <Modal.Section>
            <Text as="p">Your widget changes have not been saved yet.</Text>
          </Modal.Section>
        </Modal>
      )}

      <Layout>
        <Layout.Section variant="oneHalf">
          <BlockStack gap="400">
            {!synced && (
              <Banner
                tone="warning"
                title="Storefront not updated"
                action={{
                  content: 'Retry',
                  onAction: republish,
                  loading: republishing,
                }}
              >
                Your settings were saved, but we could not update your storefront. Shoppers still
                see the previous text.
              </Banner>
            )}

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
