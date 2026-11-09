'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/components/session-provider';
import { C } from '@/components/tokens';
import { PremiumSelect } from '@/components/ui/premium-select';
import { ListState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { canManageOrg } from '@/lib/roles';
import { validateResetPassword, validateStaffForm } from '@/lib/staff-form';
import { staffLimitState } from '@/lib/staff-limit';

type Branch = { id: string; name: string; isActive: boolean };
type BranchesRes = { branches: Branch[]; staffLimitPerBranch: number };
type Staff = {
  id: string;
  branchId: string;
  userId: string;
  email: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
};
type StaffRes = { staff: Staff[] };

const FULL_TEXT = 'This branch already has its maximum number of staff';

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
const selectWrap: React.CSSProperties = {
  border: `1px solid ${C.border2}`,
  borderRadius: 8,
  background: C.field,
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
const card: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 16,
};
const errBox: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  border: `1px solid ${C.danger}`,
  fontSize: 13,
  color: C.danger,
};

const msgOf = (e: unknown) =>
  e instanceof Error ? e.message : 'The request could not be completed.';

/** Password input with a show/hide toggle. The value is owned by the caller. */
function PasswordField({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        aria-label={label}
        placeholder={label}
        type={shown ? 'text' : 'password'}
        autoComplete="new-password"
        // biome-ignore lint/a11y/noAutofocus: the reset modal opens for this single field
        autoFocus={autoFocus}
        maxLength={128}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, paddingRight: 44 }}
      />
      <button
        type="button"
        aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        aria-pressed={shown}
        onClick={() => setShown((s) => !s)}
        style={{
          position: 'absolute',
          right: 4,
          top: 4,
          width: 32,
          height: 32,
          border: 'none',
          background: 'transparent',
          color: C.mid,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {shown ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}

/**
 * Mounted only while open, so the typed password lives in this component's state and
 * is dropped on unmount. Plain async (not useMutation) so the password never lands in
 * the react-query mutation cache.
 */
function ResetPasswordModal({ staff, onClose }: { staff: Staff; onClose: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  // Captured during the first render, before the autofocused field steals focus from the
  // trigger. Restored on unmount, which covers cancel, Escape and a successful reset alike.
  const [opener] = useState(() =>
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );
  useEffect(
    () => () => {
      if (opener?.isConnected) opener.focus();
    },
    [opener],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  // Keep Tab inside the dialog.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const f = el.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])');
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateResetPassword(pw, confirm);
    if (err) return setError(err);
    setBusy(true);
    setError(null);
    try {
      await apiFetch<{ ok: true }>(`/v1/merchant/org/staff/${staff.id}/password`, {
        method: 'POST',
        body: JSON.stringify({ password: pw }),
      });
      setPw('');
      setConfirm('');
      toast.show('Password updated', 'success');
      onClose();
    } catch (e2) {
      setBusy(false);
      setError(msgOf(e2));
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: click-outside-to-dismiss backdrop; Escape is handled above
    <div
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: `color-mix(in srgb, ${C.dark} 55%, transparent)`,
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: onClick only stops backdrop propagation */}
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-password-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 24,
          width: 380,
          maxWidth: '100%',
          display: 'grid',
          gap: 12,
        }}
      >
        <h3
          id="reset-password-title"
          style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}
        >
          Reset password for {staff.displayName}
        </h3>
        <PasswordField label="New password" value={pw} onChange={setPw} autoFocus />
        <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} />
        {error && (
          <div role="alert" style={errBox}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} disabled={busy} style={btn()}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            style={{ ...btn(true), display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            Update password
          </button>
        </div>
      </form>
    </div>
  );
}

export default function StaffPage() {
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
  const staff = useQuery({
    queryKey: ['org', 'staff'],
    queryFn: () => apiFetch<StaffRes>('/v1/merchant/org/staff'),
    enabled: isAdmin,
  });

  const [form, setForm] = useState({ branchId: '', email: '', displayName: '', password: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState<Staff | null>(null);

  if (status !== 'ready' || !me || !isAdmin) return null;

  const limit = branches.data?.staffLimitPerBranch ?? 0;
  const allBranches = branches.data?.branches ?? [];
  const activeBranches = allBranches.filter((b) => b.isActive);
  const list = staff.data?.staff ?? [];
  const used = (branchId: string) =>
    list.filter((s) => s.branchId === branchId && s.isActive).length;
  const refresh = () => qc.invalidateQueries({ queryKey: ['org'] });

  // Default to the only active branch so a single-branch merchant does not have to pick.
  const selectedBranch =
    form.branchId || (activeBranches.length === 1 ? (activeBranches[0]?.id ?? '') : '');
  const selectedLimit = selectedBranch ? staffLimitState(used(selectedBranch), limit) : null;
  const createBlocked = !!selectedLimit?.atLimit;

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = { ...form, branchId: selectedBranch };
    const err = validateStaffForm(next);
    if (err) return setCreateError(err);
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch('/v1/merchant/org/staff', {
        method: 'POST',
        body: JSON.stringify({
          branchId: next.branchId,
          email: next.email.trim(),
          displayName: next.displayName.trim(),
          password: next.password,
        }),
      });
      setForm({ branchId: next.branchId, email: '', displayName: '', password: '' });
      toast.show('Staff member added.', 'success');
      void refresh();
    } catch (e2) {
      // Covers STAFF_LIMIT_REACHED and 409 CONFLICT (e.g. email already in use): the API
      // message says which, so show it as-is under the form.
      setCreateError(msgOf(e2));
    } finally {
      setCreating(false);
    }
  };

  const patchStaff = async (s: Staff, body: { isActive?: boolean; branchId?: string }) => {
    setBusyIds((p) => new Set(p).add(s.id));
    setRowErrors((p) => {
      const { [s.id]: _drop, ...rest } = p;
      return rest;
    });
    try {
      await apiFetch(`/v1/merchant/org/staff/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      void refresh();
    } catch (e) {
      setRowErrors((p) => ({ ...p, [s.id]: msgOf(e) }));
    } finally {
      setBusyIds((p) => {
        const n = new Set(p);
        n.delete(s.id);
        return n;
      });
    }
  };

  const groups = allBranches
    .map((b) => ({ branch: b, members: list.filter((s) => s.branchId === b.id) }))
    .filter((g) => g.members.length > 0 || g.branch.isActive);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: '0 0 16px' }}>Staff</h1>

      <form onSubmit={submitCreate} style={{ ...card, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 10 }}>
          Add a staff member
        </div>
        <div
          style={{
            display: 'grid',
            gap: 10,
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          }}
        >
          <div style={selectWrap}>
            <PremiumSelect
              ariaLabel="Branch"
              fullWidth
              height={38}
              fontSize={14}
              placeholder="Choose a branch"
              value={selectedBranch}
              onChange={(v) => setForm({ ...form, branchId: String(v) })}
              options={activeBranches.map((b) => ({ value: b.id, label: b.name }))}
              disabled={activeBranches.length === 0}
            />
          </div>
          <input
            aria-label="Name"
            placeholder="Name"
            maxLength={120}
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            style={inputStyle}
          />
          <input
            aria-label="Email"
            placeholder="Email"
            type="email"
            autoComplete="off"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            style={inputStyle}
          />
          <PasswordField
            label="Initial password"
            value={form.password}
            onChange={(v) => setForm({ ...form, password: v })}
          />
        </div>
        {createBlocked && (
          <div role="status" style={{ fontSize: 13, color: C.mid, marginTop: 10 }}>
            {FULL_TEXT}
          </div>
        )}
        {createError && (
          <div role="alert" style={{ ...errBox, marginTop: 10 }}>
            {createError}
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <button
            type="submit"
            disabled={creating || createBlocked || activeBranches.length === 0}
            style={{ ...btn(true), opacity: creating || createBlocked ? 0.6 : 1 }}
          >
            {creating ? 'Adding...' : 'Add staff member'}
          </button>
        </div>
      </form>

      <ListState
        status={staff.status === 'success' ? branches.status : staff.status}
        isEmpty={groups.length === 0}
        emptyText="No branches yet. Add a branch first, then add staff to it."
        error="Could not load staff."
        onRetry={() => {
          void staff.refetch();
          void branches.refetch();
        }}
      >
        <div style={{ display: 'grid', gap: 16 }}>
          {groups.map(({ branch, members }) => {
            const lim = staffLimitState(used(branch.id), limit);
            return (
              <section key={branch.id} aria-label={branch.name} style={card}>
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'baseline',
                    flexWrap: 'wrap',
                    marginBottom: 8,
                  }}
                >
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>
                    {branch.name}
                  </h2>
                  <span style={{ fontSize: 13, color: lim.atLimit ? C.danger : C.mid }}>
                    {lim.label} staff
                  </span>
                  {!branch.isActive && <span style={{ fontSize: 12, color: C.mid }}>Inactive</span>}
                </div>
                {members.length === 0 ? (
                  <div style={{ fontSize: 13, color: C.mid }}>No staff in this branch yet.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 10 }}>
                    {members.map((s) => {
                      const busy = busyIds.has(s.id);
                      const reactivateBlocked = !s.isActive && lim.atLimit;
                      return (
                        <div
                          key={s.id}
                          style={{
                            borderTop: `1px solid ${C.border}`,
                            paddingTop: 10,
                            opacity: s.isActive ? 1 : 0.75,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              gap: 12,
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                            }}
                          >
                            <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
                                {s.displayName}
                                {!s.isActive && (
                                  <span style={{ fontSize: 12, color: C.mid, marginLeft: 8 }}>
                                    Inactive
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 13, color: C.mid, overflowWrap: 'anywhere' }}>
                                {s.email}
                              </div>
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                gap: 8,
                                flexWrap: 'wrap',
                                alignItems: 'center',
                              }}
                            >
                              <div style={{ ...selectWrap, minWidth: 150 }}>
                                <PremiumSelect
                                  ariaLabel={`Move ${s.displayName} to another branch`}
                                  fullWidth
                                  height={34}
                                  fontSize={13}
                                  value={s.branchId}
                                  disabled={busy}
                                  onChange={(v) => {
                                    if (v !== s.branchId)
                                      void patchStaff(s, { branchId: String(v) });
                                  }}
                                  options={activeBranches.map((b) => ({
                                    value: b.id,
                                    label: b.name,
                                  }))}
                                />
                              </div>
                              <button
                                type="button"
                                aria-label={`Reset password for ${s.displayName}`}
                                disabled={busy}
                                onClick={() => setResetting(s)}
                                style={btn()}
                              >
                                Reset password
                              </button>
                              {s.isActive ? (
                                <button
                                  type="button"
                                  aria-label={`Deactivate ${s.displayName}`}
                                  disabled={busy}
                                  onClick={() => void patchStaff(s, { isActive: false })}
                                  style={btn(false, true)}
                                >
                                  Deactivate
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  aria-label={`Reactivate ${s.displayName}`}
                                  title={reactivateBlocked ? FULL_TEXT : undefined}
                                  disabled={busy || reactivateBlocked}
                                  onClick={() => void patchStaff(s, { isActive: true })}
                                  style={{ ...btn(), opacity: reactivateBlocked ? 0.6 : 1 }}
                                >
                                  Reactivate
                                </button>
                              )}
                            </div>
                          </div>
                          {reactivateBlocked && !rowErrors[s.id] && (
                            <div style={{ fontSize: 12, color: C.mid, marginTop: 6 }}>
                              {FULL_TEXT}
                            </div>
                          )}
                          {rowErrors[s.id] && (
                            <div role="alert" style={{ ...errBox, marginTop: 8 }}>
                              {rowErrors[s.id]}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </ListState>

      {resetting && <ResetPasswordModal staff={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}
