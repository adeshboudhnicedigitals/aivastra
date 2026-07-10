import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  Select,
  SkeletonBodyText,
  Text,
  TextField,
} from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { FunnelRuleCondition, FunnelTemplateItem } from '../types';

const FIELD_OPTIONS = [
  { label: 'Product type', value: 'product_type' },
  { label: 'Tags', value: 'tags' },
  { label: 'Vendor', value: 'vendor' },
];
const OPERATOR_OPTIONS = [
  { label: 'Equals', value: 'equals' },
  { label: 'Contains', value: 'contains' },
];

export default function FunnelSetupPage() {
  const [items, setItems] = useState<FunnelTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<{ items: FunnelTemplateItem[] }>('/v1/shopify/funnel-templates')
      .then((data) => setItems(data.items))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function updateLocalRule(id: string, rule: FunnelTemplateItem['rule']) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, rule } : i)));
  }

  async function saveRule(item: FunnelTemplateItem) {
    setSavingId(item.id);
    setError(null);
    try {
      await apiFetch(`/v1/shopify/funnel-templates/${item.id}/rule`, {
        method: 'PATCH',
        body: JSON.stringify(item.rule),
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  async function rerun() {
    setRerunning(true);
    setError(null);
    try {
      await apiFetch('/v1/shopify/funnel-templates/re-run', { method: 'POST' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRerunning(false);
    }
  }

  function addCondition(item: FunnelTemplateItem) {
    updateLocalRule(item.id, {
      ...item.rule,
      conditions: [
        ...item.rule.conditions,
        { field: 'product_type', operator: 'equals', value: '' },
      ],
    });
  }

  function updateCondition(
    item: FunnelTemplateItem,
    index: number,
    patch: Partial<FunnelRuleCondition>,
  ) {
    const conditions = item.rule.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c));
    updateLocalRule(item.id, { ...item.rule, conditions });
  }

  function removeCondition(item: FunnelTemplateItem, index: number) {
    updateLocalRule(item.id, {
      ...item.rule,
      conditions: item.rule.conditions.filter((_, i) => i !== index),
    });
  }

  if (loading) {
    return (
      <Page title="Funnel Setup">
        <Layout>
          <Layout.Section>
            <Card>
              <SkeletonBodyText lines={6} />
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page title="Funnel Setup">
      <Layout>
        <Layout.Section>
          {error && (
            <div style={{ marginBottom: '16px' }}>
              <Banner tone="critical" title="Something went wrong">
                {error}
              </Banner>
            </div>
          )}
          <div style={{ marginBottom: '16px' }}>
            <Banner tone="info">
              Manual funnels: assign products individually from the Products page. Automated
              funnels: products matching every condition below get assigned automatically whenever
              they sync.
            </Banner>
          </div>

          <BlockStack gap="400">
            {items.map((item) => (
              <Card key={item.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      {item.label}
                    </Text>
                    <Select
                      label="Mode"
                      labelHidden
                      options={[
                        { label: 'Manual', value: 'manual' },
                        { label: 'Automated', value: 'automated' },
                      ]}
                      value={item.rule.mode}
                      onChange={(mode) =>
                        updateLocalRule(item.id, {
                          ...item.rule,
                          mode: mode as 'manual' | 'automated',
                        })
                      }
                    />
                  </InlineStack>

                  {item.rule.mode === 'automated' && (
                    <BlockStack gap="200">
                      {item.rule.conditions.map((cond, index) => (
                        <InlineStack key={index} gap="200">
                          <Select
                            label="Field"
                            labelHidden
                            options={FIELD_OPTIONS}
                            value={cond.field}
                            onChange={(field) =>
                              updateCondition(item, index, {
                                field: field as FunnelRuleCondition['field'],
                              })
                            }
                          />
                          <Select
                            label="Operator"
                            labelHidden
                            options={OPERATOR_OPTIONS}
                            value={cond.operator}
                            onChange={(operator) =>
                              updateCondition(item, index, {
                                operator: operator as FunnelRuleCondition['operator'],
                              })
                            }
                          />
                          <TextField
                            label="Value"
                            labelHidden
                            autoComplete="off"
                            value={cond.value}
                            onChange={(value) => updateCondition(item, index, { value })}
                          />
                          <Button onClick={() => removeCondition(item, index)}>Remove</Button>
                        </InlineStack>
                      ))}
                      <InlineStack gap="200">
                        <Button onClick={() => addCondition(item)}>Add condition</Button>
                        <TextField
                          label="Priority"
                          labelHidden
                          type="number"
                          autoComplete="off"
                          value={String(item.rule.priority)}
                          onChange={(value) =>
                            updateLocalRule(item.id, { ...item.rule, priority: Number(value) || 0 })
                          }
                        />
                      </InlineStack>
                    </BlockStack>
                  )}

                  <Button
                    onClick={() => saveRule(item)}
                    loading={savingId === item.id}
                    variant="primary"
                  >
                    Save
                  </Button>
                </BlockStack>
              </Card>
            ))}
          </BlockStack>

          <div style={{ marginTop: '16px' }}>
            <Card>
              <InlineStack align="space-between">
                <Text as="p">
                  Re-evaluate all non-manually-assigned products against saved rules.
                </Text>
                <Button onClick={rerun} loading={rerunning}>
                  Re-run rules
                </Button>
              </InlineStack>
            </Card>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
