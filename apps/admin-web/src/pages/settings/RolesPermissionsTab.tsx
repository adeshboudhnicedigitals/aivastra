import { useEffect, useState } from 'react';
import { apiErrorMessage, apiFetch } from '../../lib/data';

interface Permission {
  id: string;
  key: string;
  description: string | null;
}
interface MatrixResponse {
  roles: string[];
  editableRoles: string[];
  permissions: Permission[];
  matrix: Record<string, string[]>;
}

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function RolesPermissionsTab({ toast }: Props) {
  const [data, setData] = useState<MatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null); // `${role}:${key}` in flight

  useEffect(() => {
    apiFetch<MatrixResponse>('/admin/role-permissions')
      .then(setData)
      .catch((e) =>
        toast({
          kind: 'error',
          title: 'Failed to load roles & permissions',
          body: apiErrorMessage(e, 'Please try again.'),
        }),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  async function toggle(role: string, key: string, nextGranted: boolean) {
    if (!data) return;
    const cellId = `${role}:${key}`;
    setPending(cellId);
    // Optimistic update — the matrix is small enough that a wrong flash from a
    // rejected PATCH is cheaper than a full reload per click.
    const rolled = data.matrix[role]?.includes(key) ?? false;
    setData({
      ...data,
      matrix: {
        ...data.matrix,
        [role]: nextGranted
          ? [...data.matrix[role], key]
          : data.matrix[role].filter((k) => k !== key),
      },
    });
    try {
      await apiFetch('/admin/role-permissions', {
        method: 'PATCH',
        body: JSON.stringify({ role, permissionKey: key, granted: nextGranted }),
      });
    } catch (e) {
      setData(
        (prev) =>
          prev && {
            ...prev,
            matrix: {
              ...prev.matrix,
              [role]: rolled
                ? [...prev.matrix[role], key]
                : prev.matrix[role].filter((k) => k !== key),
            },
          },
      );
      toast({
        kind: 'error',
        title: 'Failed to update permission',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setPending(null);
    }
  }

  if (loading) return <p className="sub">Loading&hellip;</p>;
  if (!data) return null;

  return (
    <div style={{ overflowX: 'auto' }}>
      <p className="lede" style={{ marginBottom: 16 }}>
        Super Admin always has every permission and can't be edited here — it's the account that
        recovers access if a role gets misconfigured.
      </p>
      <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '0.5rem' }}>Permission</th>
            {data.roles.map((role) => (
              <th
                key={role}
                style={{ padding: '0.5rem', textAlign: 'center', fontSize: '0.75rem' }}
              >
                {role}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.permissions.map((perm) => (
            <tr key={perm.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '0.5rem' }}>
                <div style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>{perm.key}</div>
                {perm.description && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                    {perm.description}
                  </div>
                )}
              </td>
              {data.roles.map((role) => {
                const editable = data.editableRoles.includes(role);
                const checked = data.matrix[role]?.includes(perm.key) ?? false;
                return (
                  <td key={role} style={{ padding: '0.5rem', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!editable || pending === `${role}:${perm.key}`}
                      onChange={(e) => toggle(role, perm.key, e.target.checked)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
