import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage, apiFetch } from '../lib/data';
import type { MerchantOrg } from '../types';
import { SearchableSelect } from './SearchableSelect';
import { StatusBadge } from './StatusBadge';

type Toast = (t: { kind?: 'error' | 'warning' | 'success'; title: string; body?: string }) => void;

// v1.0 org model: AiVastra admin view of a merchant's branches and staff. Creation
// happens in Merchant Web; here admin can deactivate, re-activate and move staff.
// canEdit mirrors the API's requireAdmin(['SUPER_ADMIN', 'ADMIN']) on the PATCH routes.
export function MerchantOrgPanel({
  merchantId,
  toast,
  canEdit,
}: {
  merchantId: string;
  toast: Toast;
  canEdit: boolean;
}) {
  const [org, setOrg] = useState<MerchantOrg | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOrg(await apiFetch<MerchantOrg>(`/admin/merchants/${merchantId}/org`));
    } catch (err) {
      toast({ kind: 'error', title: apiErrorMessage(err, 'Failed to load branches') });
    }
  }, [merchantId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(path: string, body: Record<string, unknown>, key: string, ok: string) {
    setBusy(key);
    try {
      await apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) });
      toast({ title: ok });
      await load();
    } catch (err) {
      // e.g. 409 STAFF_LIMIT_REACHED when moving staff into a full branch.
      toast({ kind: 'error', title: apiErrorMessage(err, 'Update failed') });
    } finally {
      setBusy(null);
    }
  }

  if (!org) return null;
  const branchOptions = org.branches.map((b) => ({ id: b.id, label: b.name }));

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>Branches &amp; staff</h3>
          <span className="sub">Limit {org.staffLimitPerBranch} staff per branch</span>
        </div>
      </div>
      <div className="card-body" style={{ display: 'grid', gap: 14 }}>
        {org.branches.length === 0 && (
          <div className="sub">No branches yet — the merchant creates them in Merchant Web.</div>
        )}
        {org.branches.map((b) => (
          <div key={b.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="semi">{b.name}</span>
                {b.city && <span className="sub"> · {b.city}</span>}
              </div>
              <StatusBadge status={b.isActive ? 'active' : 'inactive'} />
              {canEdit && (
                <button
                  type="button"
                  className={`btn sm ${b.isActive ? 'danger' : 'primary'}`}
                  disabled={busy === b.id}
                  onClick={() =>
                    void patch(
                      `/admin/merchants/${merchantId}/branches/${b.id}`,
                      { isActive: !b.isActive },
                      b.id,
                      b.isActive ? 'Branch deactivated' : 'Branch activated',
                    )
                  }
                >
                  {b.isActive ? 'Deactivate' : 'Activate'}
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gap: 8, marginTop: 8, paddingLeft: 16 }}>
              {b.staff.length === 0 && <div className="sub">No staff</div>}
              {b.staff.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>{s.displayName ?? s.email ?? s.userId}</div>
                    {s.displayName && s.email && <div className="sub">{s.email}</div>}
                  </div>
                  <StatusBadge status={s.isActive ? 'active' : 'inactive'} />
                  <div style={{ width: 180 }}>
                    <SearchableSelect
                      options={branchOptions}
                      value={s.branchId}
                      disabled={!canEdit || busy === s.id}
                      ariaLabel={`Branch for ${s.displayName ?? s.email ?? 'staff member'}`}
                      onChange={(branchId) => {
                        if (branchId && branchId !== s.branchId) {
                          void patch(
                            `/admin/merchants/${merchantId}/staff/${s.id}`,
                            { branchId },
                            s.id,
                            'Staff moved',
                          );
                        }
                      }}
                    />
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      className={`btn sm ${s.isActive ? 'danger' : 'primary'}`}
                      disabled={busy === s.id}
                      onClick={() =>
                        void patch(
                          `/admin/merchants/${merchantId}/staff/${s.id}`,
                          { isActive: !s.isActive },
                          s.id,
                          s.isActive ? 'Staff deactivated' : 'Staff activated',
                        )
                      }
                    >
                      {s.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
