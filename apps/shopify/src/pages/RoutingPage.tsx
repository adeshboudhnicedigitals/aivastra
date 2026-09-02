import {
  Badge,
  BlockStack,
  Button,
  Card,
  Checkbox,
  EmptyState,
  IndexTable,
  InlineStack,
  Modal,
  Page,
  Select,
  Spinner,
  Text,
  TextField,
  Toast,
} from '@shopify/polaris';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorBanner } from '../components/ErrorBanner';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';

interface Condition {
  field: 'product_type' | 'tags' | 'vendor' | 'collections';
  operator: 'equals' | 'contains';
  value: string;
}
interface Basket {
  id: string;
  slug: string;
  label: string;
  sortOrder: number;
}
interface StoreRule {
  id: string;
  funnelTemplateId: string;
  conditions: Condition[];
  priority: number;
}
interface GlobalRule extends StoreRule {
  disabled: boolean;
}
interface RulesResponse {
  storeRules: StoreRule[];
  globalRules: GlobalRule[];
  counts: Record<string, number>;
  countsOmitted: boolean;
  // null when countsOmitted — the catalog was never scanned, so there is no
  // count to report either way.
  unrouted: number | null;
}

const FIELD_LABEL: Record<Condition['field'], string> = {
  product_type: 'Product type',
  tags: 'Tag',
  vendor: 'Vendor',
  collections: 'Collection',
};

const FIELD_OPTIONS = (Object.keys(FIELD_LABEL) as Condition['field'][]).map((value) => ({
  value,
  label: FIELD_LABEL[value],
}));

const OPERATOR_OPTIONS: { value: Condition['operator']; label: string }[] = [
  { value: 'equals', label: 'is' },
  { value: 'contains', label: 'contains' },
];

// Mirrors funnel-rules.routes.ts's Condition/Conditions/CreateRuleBody zod
// schemas exactly, so a merchant hits this limit here instead of learning it
// from a 400 after already filling the form in.
const MIN_CONDITIONS = 1;
const MAX_CONDITIONS = 20;
const MAX_VALUE_LENGTH = 200;
const MIN_PRIORITY = 0;
const MAX_PRIORITY = 10_000;

/** "Tag contains "saree" or Product type is "Saree"" — the merchant never
 *  sees the raw condition objects, only this. */
export function describeConditions(conditions: Condition[]): string {
  if (conditions.length === 0) return 'Matches nothing — add a condition';
  return conditions
    .map(
      (c) => `${FIELD_LABEL[c.field]} ${c.operator === 'equals' ? 'is' : 'contains'} "${c.value}"`,
    )
    .join(' or ');
}

function emptyCondition(): Condition {
  return { field: 'product_type', operator: 'equals', value: '' };
}

function RuleEditorModal({
  rule,
  baskets,
  takenBasketIds,
  onClose,
  onSaved,
}: {
  // null = creating a new rule; otherwise editing this one. The API's
  // PatchRuleBody has no funnelTemplateId field — a rule's basket is fixed at
  // creation, so edit mode locks that select rather than pretending it works.
  rule: StoreRule | null;
  baskets: Basket[];
  takenBasketIds: Set<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [funnelTemplateId, setFunnelTemplateId] = useState(
    rule?.funnelTemplateId ?? baskets[0]?.id ?? '',
  );
  const [conditions, setConditions] = useState<Condition[]>(
    rule ? rule.conditions.map((c) => ({ ...c })) : [emptyCondition()],
  );
  const [priority, setPriority] = useState(String(rule?.priority ?? 0));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<ClassifiedError | null>(null);

  const basketOptions = baskets.map((b) => ({
    value: b.id,
    label: b.label,
    // Creating a second rule for a basket you already have one for is a 409
    // from the API (CONFLICT — "edit it instead") — disable it here so the
    // merchant sees why rather than hitting a 400/409 on submit.
    disabled: rule === null && takenBasketIds.has(b.id) && b.id !== funnelTemplateId,
  }));

  const trimmedConditions = conditions.map((c) => ({ ...c, value: c.value.trim() }));
  const conditionsValid =
    trimmedConditions.length >= MIN_CONDITIONS &&
    trimmedConditions.length <= MAX_CONDITIONS &&
    trimmedConditions.every((c) => c.value.length >= 1 && c.value.length <= MAX_VALUE_LENGTH);
  const priorityNum = Number(priority);
  const priorityValid =
    Number.isInteger(priorityNum) && priorityNum >= MIN_PRIORITY && priorityNum <= MAX_PRIORITY;
  const basketValid = rule !== null || funnelTemplateId !== '';
  const canSubmit = conditionsValid && priorityValid && basketValid && !saving;

  function updateCondition(index: number, patch: Partial<Condition>) {
    setConditions((cs) => cs.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function removeCondition(index: number) {
    setConditions((cs) => cs.filter((_, i) => i !== index));
  }

  async function submit() {
    setSaving(true);
    setFormError(null);
    try {
      const body = { conditions: trimmedConditions, priority: priorityNum };
      if (rule === null) {
        await apiFetch('/v1/shopify/funnel-rules', {
          method: 'POST',
          body: JSON.stringify({ funnelTemplateId, ...body }),
        });
        onSaved('Rule added.');
      } else {
        await apiFetch(`/v1/shopify/funnel-rules/${rule.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        onSaved('Rule updated.');
      }
      onClose();
    } catch (err) {
      setFormError(classifyError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={rule === null ? 'Add rule' : 'Edit rule'}
      onClose={onClose}
      primaryAction={{ content: 'Save', onAction: submit, loading: saving, disabled: !canSubmit }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose, disabled: saving }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <ErrorBanner error={formError} onDismiss={() => setFormError(null)} />

          <Select
            label="Route to"
            options={basketOptions}
            value={funnelTemplateId}
            onChange={setFunnelTemplateId}
            disabled={rule !== null}
            helpText={
              rule !== null
                ? "The basket a rule routes to can't be changed after it's created — delete this rule and add a new one to route it elsewhere."
                : undefined
            }
          />

          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              Match products where
            </Text>
            {conditions.map((condition, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable identity of their own until saved — index is fine for a client-only draft list that's never reordered.
              <InlineStack key={index} gap="200" blockAlign="start" wrap={false}>
                <Select
                  label="Field"
                  labelHidden={index > 0}
                  options={FIELD_OPTIONS}
                  value={condition.field}
                  onChange={(value) =>
                    updateCondition(index, { field: value as Condition['field'] })
                  }
                />
                <Select
                  label="Match"
                  labelHidden={index > 0}
                  options={OPERATOR_OPTIONS}
                  value={condition.operator}
                  onChange={(value) =>
                    updateCondition(index, { operator: value as Condition['operator'] })
                  }
                />
                <TextField
                  label="Value"
                  labelHidden={index > 0}
                  autoComplete="off"
                  value={condition.value}
                  onChange={(value) => updateCondition(index, { value })}
                  maxLength={MAX_VALUE_LENGTH}
                  showCharacterCount
                />
                <Button
                  accessibilityLabel="Remove condition"
                  disabled={conditions.length <= MIN_CONDITIONS}
                  onClick={() => removeCondition(index)}
                >
                  Remove
                </Button>
              </InlineStack>
            ))}
            <InlineStack align="space-between">
              <Button
                disabled={conditions.length >= MAX_CONDITIONS}
                onClick={() => setConditions((cs) => [...cs, emptyCondition()])}
              >
                Add condition
              </Button>
              <Text as="span" tone="subdued">
                {conditions.length} / {MAX_CONDITIONS} conditions
              </Text>
            </InlineStack>
            <Text as="p" tone="subdued">
              A product matches this rule if any one condition above is true.
            </Text>
          </BlockStack>

          <TextField
            label="Priority"
            type="number"
            autoComplete="off"
            value={priority}
            onChange={setPriority}
            helpText="Lower numbers are checked first — a rule with priority 10 wins over one with priority 20."
          />
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

function basketLabelFor(baskets: Basket[], id: string): string {
  return baskets.find((b) => b.id === id)?.label ?? 'Unknown basket';
}

export default function RoutingPage() {
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [rules, setRules] = useState<RulesResponse | null>(null);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // null = closed. 'new' = add-rule modal. A StoreRule = editing that rule.
  const [editorTarget, setEditorTarget] = useState<StoreRule | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, r] = await Promise.all([
        apiFetch<{ items: Basket[] }>('/v1/shopify/baskets'),
        apiFetch<RulesResponse>('/v1/shopify/funnel-rules'),
      ]);
      setBaskets(b.items);
      setRules(r);
      setError(null);
    } catch (e) {
      setError(classifyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setDisabled = useCallback(
    async (ruleId: string, disabled: boolean) => {
      await apiFetch(`/v1/shopify/funnel-rules/${ruleId}/disabled`, {
        method: 'PUT',
        body: JSON.stringify({ disabled }),
      });
      await load();
    },
    [load],
  );

  const basketLabel = useCallback((id: string) => basketLabelFor(baskets, id), [baskets]);

  const takenBasketIds = useMemo(
    () => new Set((rules?.storeRules ?? []).map((r) => r.funnelTemplateId)),
    [rules],
  );

  async function toggleGlobalRule(rule: GlobalRule) {
    try {
      await setDisabled(rule.id, !rule.disabled);
      setToastMessage(rule.disabled ? 'Default rule turned back on.' : 'Default rule turned off.');
    } catch (err) {
      setError(classifyError(err));
    }
  }

  async function deleteRule(rule: StoreRule) {
    if (!window.confirm(`Delete this rule routing to ${basketLabel(rule.funnelTemplateId)}?`)) {
      return;
    }
    try {
      await apiFetch(`/v1/shopify/funnel-rules/${rule.id}`, { method: 'DELETE' });
      await load();
      setToastMessage('Rule deleted.');
    } catch (err) {
      setError(classifyError(err));
    }
  }

  function closeEditor() {
    setEditorTarget(null);
  }

  async function handleSaved(message: string) {
    await load();
    setToastMessage(message);
  }

  if (loading) {
    return (
      <Page title="Routing">
        <Card>
          <Spinner accessibilityLabel="Loading routing rules" />
        </Card>
      </Page>
    );
  }

  return (
    <Page title="Routing" subtitle="Choose which try-on style each product uses.">
      <BlockStack gap="400">
        <ErrorBanner error={error} onRetry={load} onDismiss={() => setError(null)} />

        {rules && (
          <>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Your rules
                  </Text>
                  <Button disabled={baskets.length === 0} onClick={() => setEditorTarget('new')}>
                    Add rule
                  </Button>
                </InlineStack>
                <IndexTable
                  selectable={false}
                  itemCount={rules.storeRules.length}
                  resourceName={{ singular: 'rule', plural: 'rules' }}
                  headings={[
                    { title: 'Basket' },
                    { title: 'Conditions' },
                    { title: 'Priority' },
                    { title: '' },
                  ]}
                  emptyState={
                    <EmptyState
                      heading="No custom rules yet"
                      action={{ content: 'Add rule', onAction: () => setEditorTarget('new') }}
                      image=""
                    >
                      <Text as="p">
                        Products fall back to AiVastra's default rules below until you add one.
                      </Text>
                    </EmptyState>
                  }
                >
                  {rules.storeRules.map((rule, index) => (
                    <IndexTable.Row id={rule.id} key={rule.id} position={index}>
                      <IndexTable.Cell>
                        <Text as="span" fontWeight="semibold">
                          {basketLabel(rule.funnelTemplateId)}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{describeConditions(rule.conditions)}</IndexTable.Cell>
                      <IndexTable.Cell>{rule.priority}</IndexTable.Cell>
                      <IndexTable.Cell>
                        <InlineStack gap="200">
                          <Button size="slim" onClick={() => setEditorTarget(rule)}>
                            Edit
                          </Button>
                          <Button size="slim" tone="critical" onClick={() => deleteRule(rule)}>
                            Delete
                          </Button>
                        </InlineStack>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Default rules (from AiVastra)
                </Text>
                <Text as="p" tone="subdued">
                  These apply to every store. Turn one off if it conflicts with your own rules — it
                  stays listed here so you can turn it back on.
                </Text>
                <IndexTable
                  selectable={false}
                  itemCount={rules.globalRules.length}
                  resourceName={{ singular: 'default rule', plural: 'default rules' }}
                  headings={[
                    { title: 'Basket' },
                    { title: 'Conditions' },
                    { title: 'Priority' },
                    { title: 'Enabled' },
                  ]}
                  emptyState={<EmptyState heading="No default rules" image="" />}
                >
                  {rules.globalRules.map((rule, index) => (
                    <IndexTable.Row id={rule.id} key={rule.id} position={index}>
                      <IndexTable.Cell>
                        <InlineStack gap="200" blockAlign="center">
                          <div style={{ opacity: rule.disabled ? 0.5 : 1 }}>
                            <Text as="span" fontWeight="semibold">
                              {basketLabel(rule.funnelTemplateId)}
                            </Text>
                          </div>
                          {rule.disabled && <Badge tone="info">Off for your store</Badge>}
                        </InlineStack>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <div style={{ opacity: rule.disabled ? 0.5 : 1 }}>
                          {describeConditions(rule.conditions)}
                        </div>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <div style={{ opacity: rule.disabled ? 0.5 : 1 }}>{rule.priority}</div>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Checkbox
                          label="Enabled"
                          labelHidden
                          checked={!rule.disabled}
                          onChange={() => toggleGlobalRule(rule)}
                        />
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Where your products land
                </Text>
                {rules.countsOmitted ? (
                  <Text as="p" tone="subdued">
                    Catalog too large to summarize.
                  </Text>
                ) : Object.keys(rules.counts).length === 0 && !rules.unrouted ? (
                  <Text as="p" tone="subdued">
                    No products have matched a rule yet.
                  </Text>
                ) : (
                  <BlockStack gap="200">
                    {Object.entries(rules.counts)
                      .sort(([a], [b]) => basketLabel(a).localeCompare(basketLabel(b)))
                      .map(([basketId, productCount]) => (
                        <InlineStack key={basketId} align="space-between">
                          <Text as="span">{basketLabel(basketId)}</Text>
                          <Text as="span" fontWeight="semibold">
                            {productCount}
                          </Text>
                        </InlineStack>
                      ))}
                    {rules.unrouted !== null && (
                      <InlineStack align="space-between">
                        <Text as="span" tone={rules.unrouted > 0 ? 'critical' : 'subdued'}>
                          Not routed (try-on unavailable)
                        </Text>
                        <Text
                          as="span"
                          fontWeight="semibold"
                          tone={rules.unrouted > 0 ? 'critical' : 'subdued'}
                        >
                          {rules.unrouted}
                        </Text>
                      </InlineStack>
                    )}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </>
        )}
      </BlockStack>

      {editorTarget !== null && (
        <RuleEditorModal
          rule={editorTarget === 'new' ? null : editorTarget}
          baskets={baskets}
          takenBasketIds={takenBasketIds}
          onClose={closeEditor}
          onSaved={handleSaved}
        />
      )}

      {toastMessage && <Toast content={toastMessage} onDismiss={() => setToastMessage(null)} />}
    </Page>
  );
}
