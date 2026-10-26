import { useCallback, useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '../../components/SearchableSelect';
import { useUrlState } from '../../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../../lib/data';

// WhatsApp → Baskets. A basket groups one gender's garment types that run the
// same workflow: the bot sums the classifier's per-type scores per basket,
// asks the seller to confirm the basket, and runs it as its representative.
// A type in no basket (or in an inactive one) is offered on its own.

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

const GENDERS = [
  { id: 'women', label: 'Women' },
  { id: 'men', label: 'Men' },
  { id: 'boys', label: 'Boys' },
  { id: 'girls', label: 'Girls' },
] as const;
type Gender = (typeof GENDERS)[number]['id'];

interface Basket {
  id: string;
  genderSlug: Gender;
  name: string;
  representativeSubcategoryId: string | null;
  sortOrder: number;
  isActive: boolean;
  memberIds: string[];
}

interface BasketType {
  id: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  publicApiSlug: string | null;
  basketId: string | null;
  ineligibleReason: 'lower_upload' | 'third_upload' | 'fourth_upload' | 'mannequin_step' | null;
}

const REASON_TEXT: Record<NonNullable<BasketType['ineligibleReason']>, string> = {
  lower_upload: 'needs a lower-garment photo',
  third_upload: 'needs a third photo',
  fourth_upload: 'takes an optional blouse photo',
  mannequin_step: 'two-step saree flow',
};

const card = {
  padding: '14px 16px',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface)',
} as const;

const fieldLabel = {
  color: 'var(--muted)',
  fontSize: 10,
  display: 'block',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontWeight: 600,
  marginBottom: 4,
} as const;

interface Draft {
  id: string | null;
  name: string;
  memberIds: string[];
  representativeSubcategoryId: string;
  sortOrder: number;
}

function Editor({
  draft,
  types,
  baskets,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft;
  types: BasketType[];
  baskets: Basket[];
  busy: boolean;
  onChange: (d: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const basketName = new Map(baskets.map((b) => [b.id, b.name]));
  const members = types.filter((t) => draft.memberIds.includes(t.id));
  const toggle = (id: string) =>
    onChange({
      ...draft,
      memberIds: draft.memberIds.includes(id)
        ? draft.memberIds.filter((m) => m !== id)
        : [...draft.memberIds, id],
      // A representative that is no longer a member falls back to the default.
      representativeSubcategoryId:
        draft.representativeSubcategoryId === id ? '' : draft.representativeSubcategoryId,
    });

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(560px, calc(100vw - 32px))' }}
      >
        <div className="modal-head">
          <h3>{draft.id ? 'Edit basket' : 'New basket'}</h3>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label>
            <span style={fieldLabel}>Name (shown to the seller)</span>
            <input
              className="input"
              style={{ width: '100%' }}
              value={draft.name}
              maxLength={60}
              placeholder="Men lower"
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
            />
          </label>

          <div>
            <span style={fieldLabel}>Garment types</span>
            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 6,
                maxHeight: 280,
                overflowY: 'auto',
              }}
            >
              {types.map((t) => {
                const other =
                  t.basketId && t.basketId !== draft.id ? basketName.get(t.basketId) : null;
                const disabled = t.ineligibleReason !== null;
                return (
                  <label
                    key={t.id}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                      padding: '7px 10px',
                      borderBottom: '1px solid var(--border)',
                      opacity: disabled ? 0.55 : 1,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={draft.memberIds.includes(t.id)}
                      onChange={() => toggle(t.id)}
                    />
                    <span style={{ flex: 1 }}>
                      {t.label}
                      {!t.isActive && (
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}> · inactive</span>
                      )}
                    </span>
                    <span style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'right' }}>
                      {disabled
                        ? `Not on WhatsApp: ${REASON_TEXT[t.ineligibleReason as keyof typeof REASON_TEXT]}`
                        : other
                          ? `Moves from ${other}`
                          : !t.publicApiSlug
                            ? 'No public slug: never guessed'
                            : ''}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px' }}>
              <span style={fieldLabel}>Runs as</span>
              <SearchableSelect
                ariaLabel="Representative garment type"
                options={members.map((t) => ({ id: t.id, label: t.label }))}
                value={draft.representativeSubcategoryId}
                emptyLabel="First ready type, by sort order"
                placeholder="First ready type, by sort order"
                disabled={members.length === 0}
                onChange={(id) => onChange({ ...draft, representativeSubcategoryId: id })}
              />
            </div>
            <label style={{ flex: '0 0 110px' }}>
              <span style={fieldLabel}>Sort order</span>
              <input
                className="input"
                type="number"
                min={0}
                style={{ width: '100%' }}
                value={draft.sortOrder}
                onChange={(e) => onChange({ ...draft, sortOrder: Number(e.target.value) || 0 })}
              />
            </label>
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || draft.name.trim().length === 0}
            onClick={onSave}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function BasketsTab({ toast }: Props) {
  const [genderParam, setGender] = useUrlState('gender');
  const gender: Gender = GENDERS.some((g) => g.id === genderParam)
    ? (genderParam as Gender)
    : 'women';
  const [data, setData] = useState<{ baskets: Basket[]; types: BasketType[] } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(
        await apiFetch<{ baskets: Basket[]; types: BasketType[] }>(
          `/admin/whatsapp/baskets?gender=${gender}`,
        ),
      );
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load baskets',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  }, [gender, toast]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const typeLabel = useMemo(() => new Map((data?.types ?? []).map((t) => [t.id, t.label])), [data]);
  // Offered on WhatsApp but in no active basket: each is guessed on its own.
  const loose = useMemo(() => {
    if (!data) return [];
    const active = new Set(data.baskets.filter((b) => b.isActive).map((b) => b.id));
    return data.types.filter(
      (t) => t.isActive && !t.ineligibleReason && !(t.basketId && active.has(t.basketId)),
    );
  }, [data]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const body = {
      name: draft.name.trim(),
      memberIds: draft.memberIds,
      representativeSubcategoryId: draft.representativeSubcategoryId || null,
      sortOrder: draft.sortOrder,
    };
    try {
      await apiFetch(draft.id ? `/admin/whatsapp/baskets/${draft.id}` : '/admin/whatsapp/baskets', {
        method: draft.id ? 'PATCH' : 'POST',
        body: JSON.stringify(draft.id ? body : { ...body, genderSlug: gender }),
      });
      setDraft(null);
      toast({ title: draft.id ? 'Basket saved' : 'Basket created' });
      await load();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to save basket',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (b: Basket, isActive: boolean) => {
    setBusy(true);
    try {
      await apiFetch(
        `/admin/whatsapp/baskets/${b.id}`,
        isActive
          ? { method: 'PATCH', body: JSON.stringify({ isActive: true }) }
          : { method: 'DELETE' },
      );
      toast({ title: isActive ? `${b.name} reactivated` : `${b.name} deactivated` });
      await load();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to update basket',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {GENDERS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`btn sm ${gender === g.id ? '' : 'secondary'}`}
            onClick={() => setGender(g.id)}
          >
            {g.label}
          </button>
        ))}
        <button
          type="button"
          className="btn sm primary"
          style={{ marginLeft: 'auto' }}
          disabled={!data}
          onClick={() =>
            setDraft({
              id: null,
              name: '',
              memberIds: [],
              representativeSubcategoryId: '',
              sortOrder: data?.baskets.length ?? 0,
            })
          }
        >
          New basket
        </button>
      </div>

      <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>
        The bot asks the gender, scores every single-image type of it, adds the scores up per basket
        and asks the seller to confirm the best one. A confirmed basket runs as the type marked
        “runs as”, or the first ready one. Types that need more than one photo are never offered on
        WhatsApp.
      </div>

      {!data ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : (
        <>
          {data.baskets.length === 0 && (
            <div style={{ ...card, color: 'var(--muted)' }}>
              No baskets for this gender yet: every type is guessed on its own.
            </div>
          )}
          {data.baskets.map((b) => (
            <div key={b.id} style={{ ...card, opacity: b.isActive ? 1 : 0.6 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{b.name}</strong>
                {!b.isActive && (
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>Inactive</span>
                )}
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                  Runs as{' '}
                  {b.representativeSubcategoryId
                    ? typeLabel.get(b.representativeSubcategoryId)
                    : 'the first ready type'}
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn sm secondary"
                    disabled={busy}
                    onClick={() =>
                      setDraft({
                        id: b.id,
                        name: b.name,
                        memberIds: b.memberIds,
                        representativeSubcategoryId: b.representativeSubcategoryId ?? '',
                        sortOrder: b.sortOrder,
                      })
                    }
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn sm ghost"
                    disabled={busy}
                    onClick={() => void setActive(b, !b.isActive)}
                  >
                    {b.isActive ? 'Deactivate' : 'Reactivate'}
                  </button>
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 13 }}>
                {b.memberIds.length === 0 ? (
                  <span style={{ color: 'var(--muted)' }}>No types yet.</span>
                ) : (
                  b.memberIds.map((id) => typeLabel.get(id) ?? id).join(', ')
                )}
              </div>
            </div>
          ))}
          {loose.length > 0 && (
            <div style={card}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Not in a basket</div>
              <div style={{ fontSize: 13 }}>{loose.map((t) => t.label).join(', ')}</div>
            </div>
          )}
        </>
      )}

      {draft && data && (
        <Editor
          draft={draft}
          types={data.types}
          baskets={data.baskets}
          busy={busy}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => void save()}
        />
      )}
    </div>
  );
}
