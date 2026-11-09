'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSession } from '@/components/session-provider';
import { C } from '@/components/tokens';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ListState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { type BranchForm, branchPatch, validateBranchForm } from '@/lib/branch-form';
import { canManageOrg } from '@/lib/roles';

type Branch = {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  isActive: boolean;
};
type BranchesRes = { branches: Branch[]; staffLimitPerBranch: number };

const inputStyle: React.CSSProperties = {
  height: 40,
  padding: '0 12px',
  borderRadius: 8,
  border: `1px solid ${C.border2}`,
  background: C.field,
  color: C.text,
  fontFamily: 'inherit',
  fontSize: 14,
  width: '100%',
  boxSizing: 'border-box',
};
const btn = (primary?: boolean, danger?: boolean): React.CSSProperties => ({
  height: 36,
  padding: '0 14px',
  borderRadius: 8,
  border: primary ? 'none' : `1px solid ${danger ? C.danger : C.border2}`,
  background: primary ? C.btnPrimary : C.white,
  color: primary ? C.white : danger ? C.danger : C.text,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
});

const toForm = (b: Branch): BranchForm => ({
  name: b.name,
  city: b.city ?? '',
  address: b.address ?? '',
});

function Fields({ form, onChange }: { form: BranchForm; onChange: (f: BranchForm) => void }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 10,
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      }}
    >
      <input
        aria-label="Branch name"
        placeholder="Name (required)"
        maxLength={120}
        value={form.name}
        onChange={(e) => onChange({ ...form, name: e.target.value })}
        style={inputStyle}
      />
      <input
        aria-label="City"
        placeholder="City"
        maxLength={120}
        value={form.city}
        onChange={(e) => onChange({ ...form, city: e.target.value })}
        style={inputStyle}
      />
      <input
        aria-label="Address"
        placeholder="Address"
        maxLength={500}
        value={form.address}
        onChange={(e) => onChange({ ...form, address: e.target.value })}
        style={inputStyle}
      />
    </div>
  );
}

const card: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 16,
};

export default function BranchesPage() {
  const { me, status } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = !!me && canManageOrg(me.role);

  useEffect(() => {
    if (status === 'ready' && me && !canManageOrg(me.role)) router.replace('/');
  }, [status, me, router]);

  const branches = useQuery({
    queryKey: ['org', 'branches'],
    queryFn: () => apiFetch<BranchesRes>('/v1/merchant/org/branches'),
    enabled: isAdmin,
  });

  const [createForm, setCreateForm] = useState<BranchForm>({ name: '', city: '', address: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<BranchForm>({ name: '', city: '', address: '' });
  const [deactivating, setDeactivating] = useState<Branch | null>(null);

  const onFail = (e: unknown) =>
    toast.show(e instanceof Error ? e.message : 'The request could not be completed.');
  const refresh = () => qc.invalidateQueries({ queryKey: ['org'] });

  const create = useMutation({
    mutationFn: (body: Partial<BranchForm>) =>
      apiFetch<Branch>('/v1/merchant/org/branches', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setCreateForm({ name: '', city: '', address: '' });
      toast.show('Branch created.', 'success');
      void refresh();
    },
    onError: onFail,
  });
  const update = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Partial<BranchForm> & { isActive?: boolean };
    }) =>
      apiFetch<Branch>(`/v1/merchant/org/branches/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setEditingId(null);
      setDeactivating(null);
      void refresh();
    },
    onError: onFail,
  });

  if (status !== 'ready' || !me || !isAdmin) return null;

  const submitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateBranchForm(createForm);
    if (err) return toast.show(err);
    const body: Partial<BranchForm> = { name: createForm.name.trim() };
    if (createForm.city.trim()) body.city = createForm.city.trim();
    if (createForm.address.trim()) body.address = createForm.address.trim();
    create.mutate(body);
  };

  const saveEdit = (b: Branch) => {
    const err = validateBranchForm(editForm);
    if (err) return toast.show(err);
    const patch = branchPatch(toForm(b), editForm);
    if (!patch) return setEditingId(null);
    update.mutate({ id: b.id, body: patch });
  };

  const list = branches.data?.branches ?? [];

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: '0 0 16px' }}>Branches</h1>

      <form onSubmit={submitCreate} style={{ ...card, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 10 }}>
          Add a branch
        </div>
        <Fields form={createForm} onChange={setCreateForm} />
        <div style={{ marginTop: 12 }}>
          <button type="submit" disabled={create.isPending} style={btn(true)}>
            {create.isPending ? 'Adding...' : 'Add branch'}
          </button>
        </div>
      </form>

      <ListState
        status={branches.status}
        isEmpty={list.length === 0}
        emptyText="No branches yet. Add your first branch above."
        error="Could not load branches."
        onRetry={() => void branches.refetch()}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          {list.map((b) => (
            <div key={b.id} style={{ ...card, opacity: b.isActive ? 1 : 0.75 }}>
              {editingId === b.id ? (
                <>
                  <Fields form={editForm} onChange={setEditForm} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      disabled={update.isPending}
                      onClick={() => saveEdit(b)}
                      style={btn(true)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={update.isPending}
                      onClick={() => setEditingId(null)}
                      style={btn()}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                    <div
                      style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{b.name}</span>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 999,
                          border: `1px solid ${b.isActive ? C.mint : C.border2}`,
                          color: b.isActive ? C.text : C.mid,
                        }}
                      >
                        {b.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: C.mid, marginTop: 4 }}>
                      {b.city || 'No city'}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: C.light,
                        marginTop: 2,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {b.address || 'No address'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(b.id);
                        setEditForm(toForm(b));
                      }}
                      style={btn()}
                    >
                      Edit
                    </button>
                    {b.isActive ? (
                      <button
                        type="button"
                        onClick={() => setDeactivating(b)}
                        style={btn(false, true)}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: b.id, body: { isActive: true } })}
                        style={btn()}
                      >
                        Reactivate
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </ListState>

      <ConfirmDialog
        open={deactivating !== null}
        title={`Deactivate ${deactivating?.name ?? 'branch'}?`}
        body="Staff and devices of this branch will stop working until you reactivate it."
        confirmLabel="Deactivate"
        danger
        busy={update.isPending}
        onConfirm={() =>
          deactivating && update.mutate({ id: deactivating.id, body: { isActive: false } })
        }
        onCancel={() => setDeactivating(null)}
      />
    </div>
  );
}
