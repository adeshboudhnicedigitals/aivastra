'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/components/session-provider';
import { C } from '@/components/tokens';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PremiumSelect } from '@/components/ui/premium-select';
import { ListState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { formatCountdown } from '@/lib/countdown';
import { validateAddDevice, validateDeviceName } from '@/lib/device-form';
import { canManageOrg } from '@/lib/roles';

type Branch = { id: string; name: string; isActive: boolean };
type BranchesRes = { branches: Branch[]; staffLimitPerBranch: number };
type Device = {
  id: string;
  branchId: string;
  name: string;
  isActive: boolean;
  paired: boolean;
  lastSeenAt: string | null;
  createdAt: string;
};
// The list GET returns a bare array.
type DevicesRes = Device[];
type Created = {
  id: string;
  branchId: string;
  name: string;
  pairingCode: string;
  pairingExpiresAt: string;
};
type Pairing = { name: string; code: string; expiresAt: number };

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
const badge = (on: boolean): React.CSSProperties => ({
  fontSize: 12,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 999,
  border: `1px solid ${on ? C.mint : C.border2}`,
  color: on ? C.text : C.mid,
});

const msgOf = (e: unknown) =>
  e instanceof Error ? e.message : 'The request could not be completed.';

const formatSeen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Never';

/**
 * Mounted only while a code is being shown, so the code lives in this component's props
 * and is dropped on unmount. It is never put in the react-query cache or logged.
 */
function PairingCodeModal({ pairing, onClose }: { pairing: Pairing; onClose: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Captured on the first render so focus returns to the Add button on close.
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
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const requestClose = () => {
    if (copied) onClose();
    else setConfirming(true);
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (confirming) setConfirming(false);
      else requestCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming]);

  // Keep Tab inside the dialog; re-run when the step changes so the focusables are current.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `confirming` swaps the dialog's buttons
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    el.querySelector<HTMLElement>('button')?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const f = el.querySelectorAll<HTMLElement>('button:not([disabled])');
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, [confirming]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pairing.code);
      setCopied(true);
      setCopyError(null);
    } catch {
      setCopyError('Could not copy automatically. Select the code and copy it by hand.');
    }
  };

  const left = formatCountdown(pairing.expiresAt - now);

  return (
    <div
      role="presentation"
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
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pairing-title"
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 24,
          width: 400,
          maxWidth: '100%',
          display: 'grid',
          gap: 12,
        }}
      >
        {confirming ? (
          <>
            <h3
              id="pairing-title"
              style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}
            >
              Close without copying?
            </h3>
            <p style={{ fontSize: 14, color: C.mid, margin: 0 }}>
              You have not copied this pairing code and it cannot be shown again. You would have to
              add the device again to get a new one.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => setConfirming(false)} style={btn()}>
                Back
              </button>
              <button type="button" onClick={onClose} style={btn(false, true)}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <h3
              id="pairing-title"
              style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}
            >
              Pairing code for {pairing.name}
            </h3>
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: 4,
                color: C.text,
                textAlign: 'center',
                padding: '12px 8px',
                border: `1px dashed ${C.border2}`,
                borderRadius: 10,
                overflowWrap: 'anywhere',
                userSelect: 'all',
              }}
            >
              {pairing.code}
            </div>
            <div
              role="timer"
              style={{ fontSize: 13, color: left === 'Expired' ? C.danger : C.mid }}
            >
              {left === 'Expired' ? 'Expired' : `Expires in ${left}`}
            </div>
            <div role="alert" style={{ ...errBox, color: C.text }}>
              This code cannot be shown again
            </div>
            {copyError && (
              <div role="alert" style={errBox}>
                {copyError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => void copy()}
                style={{ ...btn(), display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {copied ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <Copy size={14} aria-hidden="true" />
                )}
                {copied ? 'Copied' : 'Copy code'}
              </button>
              <button type="button" onClick={requestClose} style={btn(true)}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function DevicesPage() {
  const { me, status } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = !!me && canManageOrg(me.role);

  // Staff may read both; the API scopes each to their own branch.
  const branches = useQuery({
    queryKey: ['org', 'branches'],
    queryFn: () => apiFetch<BranchesRes>('/v1/merchant/org/branches'),
    enabled: !!me,
  });
  const devices = useQuery({
    queryKey: ['org', 'devices'],
    queryFn: () => apiFetch<DevicesRes>('/v1/merchant/org/devices'),
    enabled: !!me,
  });

  const [form, setForm] = useState({ branchId: '', name: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deactivating, setDeactivating] = useState<Device | null>(null);
  const [deactBusy, setDeactBusy] = useState(false);
  const [deactError, setDeactError] = useState<string | null>(null);

  if (status !== 'ready' || !me) return null;

  const allBranches = branches.data?.branches ?? [];
  const activeBranches = allBranches.filter((b) => b.isActive);
  const branchName = (id: string) => allBranches.find((b) => b.id === id)?.name ?? '-';
  const list = devices.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['org'] });
  const selectedBranch =
    form.branchId || (activeBranches.length === 1 ? (activeBranches[0]?.id ?? '') : '');

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = { branchId: selectedBranch, name: form.name };
    const err = validateAddDevice(next);
    if (err) return setCreateError(err);
    setCreating(true);
    setCreateError(null);
    try {
      // Direct call, not useMutation: the pairing code must not enter the query cache.
      const res = await apiFetch<Created>('/v1/merchant/org/devices', {
        method: 'POST',
        body: JSON.stringify({ branchId: next.branchId, name: next.name.trim() }),
      });
      setPairing({
        name: res.name,
        code: res.pairingCode,
        expiresAt: new Date(res.pairingExpiresAt).getTime(),
      });
      setForm({ branchId: next.branchId, name: '' });
      void refresh();
    } catch (e2) {
      setCreateError(msgOf(e2));
    } finally {
      setCreating(false);
    }
  };

  const patchDevice = async (
    d: Device,
    body: { name?: string; branchId?: string; isActive?: boolean },
  ): Promise<boolean> => {
    setBusyIds((p) => new Set(p).add(d.id));
    setRowErrors((p) => {
      const { [d.id]: _drop, ...rest } = p;
      return rest;
    });
    try {
      await apiFetch(`/v1/merchant/org/devices/${d.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      void refresh();
      return true;
    } catch (e) {
      setRowErrors((p) => ({ ...p, [d.id]: msgOf(e) }));
      return false;
    } finally {
      setBusyIds((p) => {
        const n = new Set(p);
        n.delete(d.id);
        return n;
      });
    }
  };

  const saveRename = async (d: Device) => {
    const err = validateDeviceName(editName);
    if (err) return setRowErrors((p) => ({ ...p, [d.id]: err }));
    const name = editName.trim();
    if (name === d.name) return setEditingId(null);
    if (await patchDevice(d, { name })) setEditingId(null);
  };

  const confirmDeactivate = async () => {
    if (!deactivating) return;
    setDeactBusy(true);
    setDeactError(null);
    try {
      await apiFetch(`/v1/merchant/org/devices/${deactivating.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: false }),
      });
      setDeactivating(null);
      toast.show('Device deactivated.', 'success');
      void refresh();
    } catch (e) {
      setDeactError(msgOf(e));
    } finally {
      setDeactBusy(false);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: '0 0 16px' }}>Devices</h1>

      {isAdmin && (
        <form onSubmit={submitCreate} style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 10 }}>
            Add a device
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
              aria-label="Device name"
              placeholder="Device name"
              maxLength={80}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              style={inputStyle}
            />
          </div>
          {createError && (
            <div role="alert" style={{ ...errBox, marginTop: 10 }}>
              {createError}
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <button
              type="submit"
              disabled={creating || activeBranches.length === 0}
              style={{ ...btn(true), opacity: creating ? 0.6 : 1 }}
            >
              {creating ? 'Adding...' : 'Add device'}
            </button>
          </div>
        </form>
      )}

      <ListState
        status={devices.status === 'success' ? branches.status : devices.status}
        isEmpty={list.length === 0}
        emptyText={
          isAdmin
            ? 'No devices yet. Add your first device above.'
            : 'No devices in your branch yet.'
        }
        error="Could not load devices."
        onRetry={() => {
          void devices.refetch();
          void branches.refetch();
        }}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          {list.map((d) => {
            const busy = busyIds.has(d.id);
            const editing = isAdmin && editingId === d.id;
            const branchOptions = activeBranches.map((b) => ({ value: b.id, label: b.name }));
            if (!branchOptions.some((o) => o.value === d.branchId)) {
              branchOptions.unshift({
                value: d.branchId,
                label: `${branchName(d.branchId)} (inactive)`,
              });
            }
            return (
              <div key={d.id} style={{ ...card, opacity: d.isActive ? 1 : 0.75 }}>
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
                    {editing ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveRename(d);
                        }}
                        style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                      >
                        <input
                          aria-label={`New name for ${d.name}`}
                          // biome-ignore lint/a11y/noAutofocus: the field appears on an explicit Rename click
                          autoFocus
                          maxLength={80}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          style={{ ...inputStyle, flex: '1 1 160px', width: 'auto' }}
                        />
                        <button type="submit" disabled={busy} style={btn(true)}>
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setEditingId(null);
                            setRowErrors((p) => {
                              const { [d.id]: _drop, ...rest } = p;
                              return rest;
                            });
                          }}
                          style={btn()}
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div
                        style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>
                          {d.name}
                        </span>
                        <span style={badge(d.isActive)}>{d.isActive ? 'Active' : 'Inactive'}</span>
                      </div>
                    )}
                    <div style={{ fontSize: 13, color: C.mid, marginTop: 6 }}>
                      Branch: {branchName(d.branchId)}
                    </div>
                    <div style={{ fontSize: 13, color: C.mid, marginTop: 2 }}>
                      Paired: {d.paired ? 'Yes' : 'No'}
                    </div>
                    <div style={{ fontSize: 13, color: C.light, marginTop: 2 }}>
                      Last seen: {formatSeen(d.lastSeenAt)}
                    </div>
                  </div>
                  {isAdmin && (
                    <div
                      style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
                    >
                      <div style={{ ...selectWrap, minWidth: 150 }}>
                        <PremiumSelect
                          ariaLabel={`Move ${d.name} to another branch`}
                          fullWidth
                          height={34}
                          fontSize={13}
                          value={d.branchId}
                          disabled={busy}
                          onChange={(v) => {
                            if (v !== d.branchId) void patchDevice(d, { branchId: String(v) });
                          }}
                          options={branchOptions}
                        />
                      </div>
                      {!editing && (
                        <button
                          type="button"
                          aria-label={`Rename ${d.name}`}
                          disabled={busy}
                          onClick={() => {
                            setEditingId(d.id);
                            setEditName(d.name);
                          }}
                          style={btn()}
                        >
                          Rename
                        </button>
                      )}
                      {d.isActive ? (
                        <button
                          type="button"
                          aria-label={`Deactivate ${d.name}`}
                          disabled={busy}
                          onClick={() => {
                            setDeactError(null);
                            setDeactivating(d);
                          }}
                          style={btn(false, true)}
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Reactivate ${d.name}`}
                          disabled={busy}
                          onClick={() => void patchDevice(d, { isActive: true })}
                          style={btn()}
                        >
                          Reactivate
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {rowErrors[d.id] && (
                  <div role="alert" style={{ ...errBox, marginTop: 8 }}>
                    {rowErrors[d.id]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ListState>

      <ConfirmDialog
        open={deactivating !== null}
        title={`Deactivate ${deactivating?.name ?? 'device'}?`}
        body="The tablet stops working and its open sessions end. You can reactivate it later."
        confirmLabel="Deactivate"
        danger
        busy={deactBusy}
        error={deactError}
        onConfirm={() => void confirmDeactivate()}
        onCancel={() => setDeactivating(null)}
      />

      {pairing && <PairingCodeModal pairing={pairing} onClose={() => setPairing(null)} />}
    </div>
  );
}
