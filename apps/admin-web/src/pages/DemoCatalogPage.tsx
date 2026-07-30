import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage, apiFetch } from '../lib/data';
import { makeThumbnail } from '../lib/thumbnail';

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  onNav: (page: string, filter?: { page: string; filter?: string }) => void;
}

interface DemoSet {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  subcategoryCount: number;
  productCount: number;
  assignedMerchantCount: number;
}

interface DemoSubcategory {
  id: string;
  category: string;
  name: string;
  garmentSubcategoryId: string;
  productCount: number;
}

interface DemoItem {
  id: string;
  label: string;
  sku: string | null;
  actualPrice: number;
  offerPrice: number;
  isActive: boolean;
  thumbnailUrl: string | null;
}

interface GarmentType {
  id: string;
  label: string;
  genderSlug: string;
}

interface MerchantRow {
  id: string;
  companyName: string;
  signupSource?: string;
}

const CATEGORIES = ['men', 'women', 'boys', 'girls'] as const;

/** Presigns, thumbnails where needed, and PUTs. Returns the resolved key. */
async function uploadDemoAsset(file: File, kind: 'image' | 'thumbnail'): Promise<string> {
  const body = kind === 'thumbnail' ? await makeThumbnail(file) : file;
  const contentType =
    file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg';
  const { uploadUrl, r2Key } = await apiFetch<{ uploadUrl: string; r2Key: string }>(
    '/admin/demo-catalog/presign',
    {
      method: 'POST',
      body: JSON.stringify({ kind, contentType, contentLength: body.size }),
    },
  );
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    body,
    headers: { 'Content-Type': contentType },
  });
  if (!res.ok) throw new Error('Image upload failed. Please try again.');
  return r2Key;
}

export default function DemoCatalogPage({ toast }: Props) {
  const [sets, setSets] = useState<DemoSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [subcategories, setSubcategories] = useState<DemoSubcategory[]>([]);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [items, setItems] = useState<DemoItem[]>([]);
  const [garmentTypes, setGarmentTypes] = useState<GarmentType[]>([]);
  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const notifyError = useCallback(
    (title: string, err: unknown) => {
      toast({ kind: 'error', title, body: apiErrorMessage(err, 'Please try again.') });
    },
    [toast],
  );

  const notifySuccess = useCallback(
    (title: string) => {
      toast({ title });
    },
    [toast],
  );

  const loadSets = useCallback(async () => {
    try {
      const res = await apiFetch<{ items: DemoSet[] }>('/admin/demo-catalog/sets');
      setSets(res.items);
    } catch (err) {
      notifyError('Could not load demo sets', err);
    }
  }, [notifyError]);

  useEffect(() => {
    void loadSets();
    void (async () => {
      try {
        const [gt, m] = await Promise.all([
          apiFetch<{ items: GarmentType[] }>('/admin/assets/garment-types'),
          apiFetch<{ items: MerchantRow[] }>('/admin/merchants'),
        ]);
        setGarmentTypes(gt.items);
        setMerchants(m.items);
      } catch (err) {
        notifyError('Could not load pickers', err);
      }
    })();
  }, [loadSets, notifyError]);

  useEffect(() => {
    if (!selectedSetId) {
      setSubcategories([]);
      setAssignedIds([]);
      setSelectedSubId(null);
      return;
    }
    void (async () => {
      try {
        const [subs, assignments] = await Promise.all([
          apiFetch<{ items: DemoSubcategory[] }>(
            `/admin/demo-catalog/sets/${selectedSetId}/subcategories`,
          ),
          apiFetch<{ items: { merchantId: string }[] }>(
            `/admin/demo-catalog/sets/${selectedSetId}/assignments`,
          ),
        ]);
        setSubcategories(subs.items);
        setAssignedIds(assignments.items.map((a) => a.merchantId));
      } catch (err) {
        notifyError('Could not load the demo set', err);
      }
    })();
  }, [selectedSetId, notifyError]);

  useEffect(() => {
    if (!selectedSubId) {
      setItems([]);
      return;
    }
    void (async () => {
      try {
        const res = await apiFetch<{ items: DemoItem[] }>(
          `/admin/demo-catalog/items?subcategoryId=${selectedSubId}`,
        );
        setItems(res.items);
      } catch (err) {
        notifyError('Could not load demo products', err);
      }
    })();
  }, [selectedSubId, notifyError]);

  async function run(title: string, fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      notifyError(title, err);
    } finally {
      setBusy(false);
    }
  }

  const createSet = (form: HTMLFormElement) =>
    run('Could not create the demo set', async () => {
      const data = new FormData(form);
      await apiFetch('/admin/demo-catalog/sets', {
        method: 'POST',
        body: JSON.stringify({
          name: String(data.get('name') ?? '').trim(),
          description: String(data.get('description') ?? '').trim() || undefined,
        }),
      });
      form.reset();
      await loadSets();
      notifySuccess('Demo set created');
    });

  const toggleSet = (set: DemoSet) =>
    run('Could not update the demo set', async () => {
      await apiFetch(`/admin/demo-catalog/sets/${set.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !set.isActive }),
      });
      await loadSets();
    });

  const deleteSet = (set: DemoSet) =>
    run('Could not delete the demo set', async () => {
      if (
        !window.confirm(
          `Delete "${set.name}"? This removes ${set.productCount} demo product(s) from ${set.assignedMerchantCount} merchant(s).`,
        )
      ) {
        return;
      }
      await apiFetch(`/admin/demo-catalog/sets/${set.id}`, { method: 'DELETE' });
      if (selectedSetId === set.id) setSelectedSetId(null);
      await loadSets();
      notifySuccess('Demo set deleted');
    });

  const saveAssignments = (merchantIds: string[]) =>
    run('Could not save merchant visibility', async () => {
      if (!selectedSetId) return;
      await apiFetch(`/admin/demo-catalog/sets/${selectedSetId}/assignments`, {
        method: 'PUT',
        body: JSON.stringify({ merchantIds }),
      });
      setAssignedIds(merchantIds);
      await loadSets();
      notifySuccess('Merchant visibility saved');
    });

  const createSubcategory = (form: HTMLFormElement) =>
    run('Could not create the subcategory', async () => {
      if (!selectedSetId) return;
      const data = new FormData(form);
      await apiFetch('/admin/demo-catalog/subcategories', {
        method: 'POST',
        body: JSON.stringify({
          setId: selectedSetId,
          category: String(data.get('category')),
          name: String(data.get('name') ?? '').trim(),
          garmentSubcategoryId: String(data.get('garmentSubcategoryId')),
        }),
      });
      form.reset();
      const subs = await apiFetch<{ items: DemoSubcategory[] }>(
        `/admin/demo-catalog/sets/${selectedSetId}/subcategories`,
      );
      setSubcategories(subs.items);
      await loadSets();
      notifySuccess('Subcategory created');
    });

  const createItem = (form: HTMLFormElement) =>
    run('Could not create the demo product', async () => {
      if (!selectedSubId) return;
      const data = new FormData(form);
      const file = data.get('image');
      if (!(file instanceof File) || file.size === 0) {
        throw new Error('Choose an image for the demo product.');
      }
      // The same file becomes both objects — full-res image plus a downscaled thumb.
      const [r2Key, thumbnailKey] = await Promise.all([
        uploadDemoAsset(file, 'image'),
        uploadDemoAsset(file, 'thumbnail'),
      ]);
      await apiFetch('/admin/demo-catalog/items', {
        method: 'POST',
        body: JSON.stringify({
          subcategoryId: selectedSubId,
          label: String(data.get('label') ?? '').trim(),
          sku: String(data.get('sku') ?? '').trim() || undefined,
          actualPrice: Number(data.get('actualPrice') ?? 0),
          offerPrice: Number(data.get('offerPrice') ?? 0),
          r2Key,
          thumbnailKey,
        }),
      });
      form.reset();
      const res = await apiFetch<{ items: DemoItem[] }>(
        `/admin/demo-catalog/items?subcategoryId=${selectedSubId}`,
      );
      setItems(res.items);
      await loadSets();
      notifySuccess('Demo product added');
    });

  const deleteItem = (item: DemoItem) =>
    run('Could not delete the demo product', async () => {
      if (!window.confirm(`Delete "${item.label}"?`)) return;
      await apiFetch(`/admin/demo-catalog/items/${item.id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      await loadSets();
    });

  const selectedSet = sets.find((s) => s.id === selectedSetId) ?? null;

  return (
    <div className="page" style={{ padding: '1.5rem' }}>
      <header className="page-head" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Kiosk Demo Data</h1>
        <p className="muted" style={{ color: 'var(--muted, #666)', fontSize: '0.875rem' }}>
          Admin-authored demo products. Merchants see them on the Android app but cannot edit or
          delete them. A set is only visible to the merchants selected below.
        </p>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '1.5rem',
        }}
      >
        <section
          className="card"
          style={{
            background: 'var(--card-bg, #fff)',
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: '0.5rem',
            padding: '1.25rem',
          }}
        >
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>Demo sets</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createSet(e.currentTarget);
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            <input
              name="name"
              placeholder="Set name"
              required
              maxLength={160}
              style={{
                padding: '0.5rem',
                border: '1px solid var(--border, #ccc)',
                borderRadius: '0.375rem',
              }}
            />
            <input
              name="description"
              placeholder="Description (optional)"
              maxLength={500}
              style={{
                padding: '0.5rem',
                border: '1px solid var(--border, #ccc)',
                borderRadius: '0.375rem',
              }}
            />
            <button
              type="submit"
              disabled={busy}
              style={{
                padding: '0.5rem 1rem',
                background: 'var(--primary, #2563eb)',
                color: '#fff',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: 'pointer',
              }}
            >
              Add set
            </button>
          </form>

          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            {sets.map((set) => (
              <li
                key={set.id}
                style={{
                  padding: '0.75rem',
                  border: '1px solid var(--border, #eee)',
                  borderRadius: '0.375rem',
                  background:
                    set.id === selectedSetId ? 'var(--highlight, #f0f9ff)' : 'transparent',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                <button
                  type="button"
                  onClick={() => setSelectedSetId(set.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  <strong style={{ display: 'block' }}>{set.name}</strong>
                  <span
                    className="muted"
                    style={{ fontSize: '0.75rem', color: 'var(--muted, #666)' }}
                  >
                    {set.subcategoryCount} subcats · {set.productCount} products ·{' '}
                    {set.assignedMerchantCount} merchants
                  </span>
                  {!set.isActive && (
                    <span
                      style={{
                        marginLeft: '0.5rem',
                        fontSize: '0.7rem',
                        background: '#fee2e2',
                        color: '#991b1b',
                        padding: '0.1rem 0.4rem',
                        borderRadius: '0.2rem',
                      }}
                    >
                      Inactive
                    </span>
                  )}
                </button>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void toggleSet(set)}
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', cursor: 'pointer' }}
                  >
                    {set.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteSet(set)}
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.25rem 0.5rem',
                      color: '#dc2626',
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section
          className="card"
          style={{
            background: 'var(--card-bg, #fff)',
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: '0.5rem',
            padding: '1.25rem',
          }}
        >
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>
            Subcategories
          </h2>
          {!selectedSet ? (
            <p className="muted" style={{ color: 'var(--muted, #666)' }}>
              Select a set.
            </p>
          ) : (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void createSubcategory(e.currentTarget);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  marginBottom: '1rem',
                }}
              >
                <select
                  name="category"
                  required
                  style={{
                    padding: '0.5rem',
                    border: '1px solid var(--border, #ccc)',
                    borderRadius: '0.375rem',
                  }}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <input
                  name="name"
                  placeholder="Subcategory name"
                  required
                  maxLength={160}
                  style={{
                    padding: '0.5rem',
                    border: '1px solid var(--border, #ccc)',
                    borderRadius: '0.375rem',
                  }}
                />
                <select
                  name="garmentSubcategoryId"
                  required
                  style={{
                    padding: '0.5rem',
                    border: '1px solid var(--border, #ccc)',
                    borderRadius: '0.375rem',
                  }}
                >
                  <option value="">Garment type…</option>
                  {garmentTypes.map((gt) => (
                    <option key={gt.id} value={gt.id}>
                      {gt.genderSlug} · {gt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={busy}
                  style={{
                    padding: '0.5rem 1rem',
                    background: 'var(--primary, #2563eb)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '0.375rem',
                    cursor: 'pointer',
                  }}
                >
                  Add subcategory
                </button>
              </form>

              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: '0 0 1.5rem 0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                {subcategories.map((sub) => (
                  <li
                    key={sub.id}
                    style={{
                      padding: '0.5rem',
                      border: '1px solid var(--border, #eee)',
                      borderRadius: '0.375rem',
                      background:
                        sub.id === selectedSubId ? 'var(--highlight, #f0f9ff)' : 'transparent',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedSubId(sub.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        textAlign: 'left',
                        cursor: 'pointer',
                        width: '100%',
                        padding: 0,
                      }}
                    >
                      <strong style={{ display: 'block' }}>{sub.name}</strong>
                      <span
                        className="muted"
                        style={{ fontSize: '0.75rem', color: 'var(--muted, #666)' }}
                      >
                        {sub.category} · {sub.productCount} products
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                Visible to merchants
              </h3>
              <select
                multiple
                size={8}
                value={assignedIds}
                onChange={(e) =>
                  setAssignedIds(Array.from(e.currentTarget.selectedOptions, (o) => o.value))
                }
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border, #ccc)',
                  borderRadius: '0.375rem',
                  marginBottom: '0.75rem',
                }}
              >
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.companyName}
                    {m.signupSource === 'android_google' ? ' (self-signup)' : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveAssignments(assignedIds)}
                style={{
                  padding: '0.5rem 1rem',
                  background: 'var(--primary, #2563eb)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                Save visibility
              </button>
            </>
          )}
        </section>

        <section
          className="card"
          style={{
            background: 'var(--card-bg, #fff)',
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: '0.5rem',
            padding: '1.25rem',
          }}
        >
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>
            Demo products
          </h2>
          {!selectedSubId ? (
            <p className="muted" style={{ color: 'var(--muted, #666)' }}>
              Select a subcategory.
            </p>
          ) : (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void createItem(e.currentTarget);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  marginBottom: '1rem',
                }}
              >
                <input
                  name="label"
                  placeholder="Product name"
                  required
                  maxLength={200}
                  style={{
                    padding: '0.5rem',
                    border: '1px solid var(--border, #ccc)',
                    borderRadius: '0.375rem',
                  }}
                />
                <input
                  name="sku"
                  placeholder="SKU (optional)"
                  maxLength={120}
                  style={{
                    padding: '0.5rem',
                    border: '1px solid var(--border, #ccc)',
                    borderRadius: '0.375rem',
                  }}
                />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    name="actualPrice"
                    type="number"
                    min={0}
                    placeholder="MRP (₹)"
                    required
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      border: '1px solid var(--border, #ccc)',
                      borderRadius: '0.375rem',
                    }}
                  />
                  <input
                    name="offerPrice"
                    type="number"
                    min={0}
                    placeholder="Offer (₹)"
                    required
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      border: '1px solid var(--border, #ccc)',
                      borderRadius: '0.375rem',
                    }}
                  />
                </div>
                <input
                  name="image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                  style={{
                    padding: '0.25rem',
                    fontSize: '0.875rem',
                  }}
                />
                <button
                  type="submit"
                  disabled={busy}
                  style={{
                    padding: '0.5rem 1rem',
                    background: 'var(--primary, #2563eb)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '0.375rem',
                    cursor: 'pointer',
                  }}
                >
                  Add product
                </button>
              </form>

              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                  gap: '0.75rem',
                }}
              >
                {items.map((item) => (
                  <li
                    key={item.id}
                    style={{
                      border: '1px solid var(--border, #eee)',
                      borderRadius: '0.375rem',
                      padding: '0.5rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem',
                    }}
                  >
                    {item.thumbnailUrl && (
                      <img
                        src={item.thumbnailUrl}
                        alt={item.label}
                        style={{
                          width: '100%',
                          height: '100px',
                          objectFit: 'cover',
                          borderRadius: '0.25rem',
                        }}
                      />
                    )}
                    <strong style={{ fontSize: '0.875rem' }}>{item.label}</strong>
                    <span
                      className="muted"
                      style={{ fontSize: '0.75rem', color: 'var(--muted, #666)' }}
                    >
                      {item.sku ?? '—'} · ₹{item.offerPrice} <s>₹{item.actualPrice}</s>
                    </span>
                    {!item.isActive && (
                      <span
                        style={{
                          fontSize: '0.7rem',
                          background: '#fee2e2',
                          color: '#991b1b',
                          padding: '0.1rem 0.4rem',
                          borderRadius: '0.2rem',
                          width: 'fit-content',
                        }}
                      >
                        Inactive
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void deleteItem(item)}
                      style={{
                        marginTop: 'auto',
                        fontSize: '0.75rem',
                        padding: '0.25rem',
                        color: '#dc2626',
                        cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
