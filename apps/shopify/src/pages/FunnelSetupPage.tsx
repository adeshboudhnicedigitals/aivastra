import { useCallback, useEffect, useState } from 'react';
import { SpinnerIcon } from '../components/icons';
import { Toast } from '../components/Toast';
import { apiFetch } from '../lib/api';
import { useToast } from '../lib/useToast';
import { BRAND } from '../theme';
import type { FunnelRuleCondition, FunnelTemplateItem } from '../types';

const FIELD_OPTIONS: { label: string; value: FunnelRuleCondition['field'] }[] = [
  { label: 'Product type', value: 'product_type' },
  { label: 'Tags', value: 'tags' },
  { label: 'Vendor', value: 'vendor' },
  { label: 'Collections', value: 'collections' },
];
const OPERATOR_OPTIONS: { label: string; value: FunnelRuleCondition['operator'] }[] = [
  { label: 'equals', value: 'equals' },
  { label: 'contains', value: 'contains' },
];

function SegmentedToggle({
  mode,
  onChange,
}: {
  mode: 'manual' | 'automated';
  onChange: (mode: 'manual' | 'automated') => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        background: '#F7F6FA',
        borderRadius: '10px',
        padding: '3px',
        gap: '2px',
      }}
    >
      {(['manual', 'automated'] as const).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            style={{
              height: '28px',
              padding: '0 12px',
              border: 'none',
              borderRadius: '8px',
              background: active ? '#fff' : 'transparent',
              color: active ? BRAND.ink : BRAND.textFaint,
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: active ? 'default' : 'pointer',
              boxShadow: active ? '0 1px 2px rgba(23,15,38,0.08)' : 'none',
              textTransform: 'capitalize',
            }}
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}

export default function FunnelSetupPage() {
  const [items, setItems] = useState<FunnelTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const { toast, showToast } = useToast();

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
    setSavedId(null);
    setError(null);
    try {
      await apiFetch(`/v1/shopify/funnel-templates/${item.id}/rule`, {
        method: 'PATCH',
        body: JSON.stringify(item.rule),
      });
      setSavedId(item.id);
      setTimeout(() => setSavedId((cur) => (cur === item.id ? null : cur)), 1800);
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
      const res = await apiFetch<{
        matched: number;
        cleared: number;
        skippedManual: number;
        evaluated: number;
      }>('/v1/shopify/funnel-templates/re-run', { method: 'POST' });
      // The old toast ("products reassigned where needed") read as success even
      // when every rule matched nothing. Zero matches is the single most common
      // misconfiguration — a rule whose value doesn't exist on any product — so
      // it gets said outright.
      if (res.evaluated === 0) {
        showToast(
          res.skippedManual > 0
            ? `No products to evaluate — all ${res.skippedManual} are pinned manually.`
            : 'No products to evaluate yet. Sync your products first.',
        );
      } else if (res.matched === 0) {
        showToast(
          `No product matched any automated rule — ${res.cleared} left without a funnel. Check your rule values against your product tags, collections, type and vendor.`,
        );
      } else {
        showToast(
          `${res.matched} product${res.matched === 1 ? '' : 's'} matched a rule` +
            (res.cleared > 0 ? `, ${res.cleared} left without a funnel` : '') +
            (res.skippedManual > 0 ? `, ${res.skippedManual} pinned manually (untouched)` : '') +
            '.',
        );
      }
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
      <div
        style={{
          background: '#fff',
          border: `1px solid ${BRAND.border}`,
          borderRadius: '16px',
          padding: '40px',
          color: BRAND.textMuted,
          fontSize: '13.5px',
        }}
      >
        Loading…
      </div>
    );
  }

  const sorted = [...items].sort((a, b) => a.rule.priority - b.rule.priority);

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '22px', fontWeight: 700, color: BRAND.ink }}>Funnel Setup</div>
        <div style={{ marginTop: '4px', fontSize: '14px', color: BRAND.textMuted }}>
          Decide what shoppers see after they try something on.
        </div>
      </div>

      {error && (
        <div
          style={{
            background: BRAND.dangerBg,
            border: '1px solid rgba(200,30,58,0.18)',
            borderRadius: '14px',
            padding: '12px 16px',
            marginBottom: '16px',
            fontSize: '13.5px',
            color: '#8C1830',
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: '12px',
          background: BRAND.purpleTint,
          border: '1px solid rgba(124,58,237,0.18)',
          borderRadius: '14px',
          padding: '14px 18px',
          marginBottom: '22px',
          boxSizing: 'border-box',
        }}
      >
        <svg
          aria-hidden="true"
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          style={{ flexShrink: 0, marginTop: '1px', color: BRAND.purpleDark }}
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M12 8h.01M11 12h1v5h1"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div style={{ fontSize: '13.5px', lineHeight: 1.6, color: '#4A3B66' }}>
          <b>Manual</b> funnels are assigned per-product from the Products page. <b>Automated</b>{' '}
          funnels use the rules below to match products — when several match, the lowest priority
          number wins.
        </div>
      </div>

      {sorted.map((funnel) => (
        <div
          key={funnel.id}
          style={{
            background: '#fff',
            border: `1px solid ${BRAND.border}`,
            borderRadius: '16px',
            padding: '22px 24px',
            marginBottom: '16px',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {funnel.rule.mode === 'automated' && (
                <span
                  style={{
                    fontSize: '11.5px',
                    fontWeight: 700,
                    color: BRAND.purpleDark,
                    background: BRAND.purpleTint,
                    padding: '3px 9px',
                    borderRadius: '999px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Priority {funnel.rule.priority}
                </span>
              )}
              <span style={{ fontSize: '15.5px', fontWeight: 700, color: BRAND.ink }}>
                {funnel.label}
              </span>
            </div>
            <SegmentedToggle
              mode={funnel.rule.mode}
              onChange={(mode) => updateLocalRule(funnel.id, { ...funnel.rule, mode })}
            />
          </div>

          {funnel.rule.mode === 'manual' ? (
            <div style={{ fontSize: '13px', color: BRAND.textFaint, marginTop: '14px' }}>
              Assigned manually from the Products page.
            </div>
          ) : (
            <div
              style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              {funnel.rule.conditions.map((cond, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: order is stable
                <div key={index} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select
                    value={cond.field}
                    onChange={(e) =>
                      updateCondition(funnel, index, {
                        field: e.target.value as FunnelRuleCondition['field'],
                      })
                    }
                    style={{
                      height: '36px',
                      border: `1px solid ${BRAND.borderInput}`,
                      borderRadius: '8px',
                      padding: '0 10px',
                      fontSize: '12.5px',
                      color: BRAND.inkSoft,
                      background: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    {FIELD_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={cond.operator}
                    onChange={(e) =>
                      updateCondition(funnel, index, {
                        operator: e.target.value as FunnelRuleCondition['operator'],
                      })
                    }
                    style={{
                      height: '36px',
                      border: `1px solid ${BRAND.borderInput}`,
                      borderRadius: '8px',
                      padding: '0 10px',
                      fontSize: '12.5px',
                      color: BRAND.inkSoft,
                      background: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    {OPERATOR_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={cond.value}
                    onChange={(e) => updateCondition(funnel, index, { value: e.target.value })}
                    placeholder="Value"
                    style={{
                      height: '36px',
                      flex: 1,
                      minWidth: 0,
                      border: `1px solid ${BRAND.borderInput}`,
                      borderRadius: '8px',
                      padding: '0 10px',
                      fontSize: '12.5px',
                      color: BRAND.ink,
                      background: '#fff',
                      boxSizing: 'border-box',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => removeCondition(funnel, index)}
                    style={{
                      width: '30px',
                      height: '30px',
                      border: 'none',
                      borderRadius: '8px',
                      background: '#F7F6FA',
                      color: BRAND.textFaint,
                      fontSize: '16px',
                      cursor: 'pointer',
                      flexShrink: 0,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addCondition(funnel)}
                style={{
                  height: '34px',
                  padding: '0 14px',
                  border: '1.5px dashed rgba(124,58,237,0.4)',
                  borderRadius: '9px',
                  background: '#FBF9FE',
                  color: BRAND.purple,
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  alignSelf: 'flex-start',
                }}
              >
                + Add condition
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
                <span style={{ fontSize: '13px', color: BRAND.textMuted }}>Priority</span>
                <input
                  type="number"
                  value={funnel.rule.priority}
                  onChange={(e) =>
                    updateLocalRule(funnel.id, {
                      ...funnel.rule,
                      priority: Number(e.target.value) || 0,
                    })
                  }
                  style={{
                    width: '56px',
                    height: '32px',
                    border: `1px solid ${BRAND.borderInput}`,
                    borderRadius: '8px',
                    padding: '0 8px',
                    fontSize: '13px',
                    color: BRAND.ink,
                    background: '#fff',
                    boxSizing: 'border-box',
                  }}
                />
                <span style={{ fontSize: '12px', color: BRAND.textFaint }}>
                  Lower number runs first
                </span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            {savingId === funnel.id ? (
              <button
                type="button"
                disabled
                style={{
                  height: '34px',
                  padding: '0 16px',
                  border: 'none',
                  borderRadius: '9px',
                  background: BRAND.buttonGradient,
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600,
                  opacity: 0.75,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                }}
              >
                <SpinnerIcon size={14} />
                Saving…
              </button>
            ) : savedId === funnel.id ? (
              <button
                type="button"
                disabled
                style={{
                  height: '34px',
                  padding: '0 16px',
                  border: 'none',
                  borderRadius: '9px',
                  background: BRAND.successBg,
                  color: BRAND.successText,
                  fontSize: '13px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                }}
              >
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 13l4 4L19 7"
                    stroke={BRAND.successText}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Saved
              </button>
            ) : (
              <button
                type="button"
                onClick={() => saveRule(funnel)}
                style={{
                  height: '34px',
                  padding: '0 16px',
                  border: 'none',
                  borderRadius: '9px',
                  background: BRAND.buttonGradient,
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Save
              </button>
            )}
          </div>
        </div>
      ))}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: '8px',
          paddingTop: '16px',
          borderTop: `1px solid ${BRAND.borderStrong}`,
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div style={{ fontSize: '13px', color: BRAND.textFaint }}>
          Re-evaluates all automated products against your saved rules.
        </div>
        <button
          type="button"
          onClick={rerun}
          disabled={rerunning}
          style={{
            height: '38px',
            padding: '0 16px',
            border: `1px solid ${BRAND.borderStrong}`,
            borderRadius: '10px',
            background: '#fff',
            color: BRAND.inkSoft,
            fontSize: '13.5px',
            fontWeight: 600,
            cursor: rerunning ? 'default' : 'pointer',
          }}
        >
          {rerunning ? 'Re-running…' : 'Re-run rules'}
        </button>
      </div>

      <Toast message={toast} />
    </div>
  );
}
