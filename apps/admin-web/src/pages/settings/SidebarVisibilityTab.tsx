import { Fragment, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icons';
import { navGroups } from '../../components/Sidebar';
import { apiErrorMessage, apiFetch } from '../../lib/data';

interface PermissionMatrixResponse {
  roles: string[];
  matrix: Record<string, string[]>;
}
interface OverridesResponse {
  editableRoles: string[];
  overrides: Record<string, Record<string, boolean>>;
}

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

function roleLabel(role: string): string {
  return role === 'SUPER_ADMIN' ? 'Super Admin' : role.charAt(0) + role.slice(1).toLowerCase();
}

// This tab only ever decides whether a sidebar item is *shown* for a role — it
// never changes what that role's API calls are allowed to do (see
// role-nav-overrides.routes.ts). Unchecked items a role still has the underlying
// permission for stay fully reachable by URL; this purely declutters the menu.
export default function SidebarVisibilityTab({ toast }: Props) {
  const [perms, setPerms] = useState<PermissionMatrixResponse | null>(null);
  const [overrides, setOverrides] = useState<OverridesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null); // `${role}:${navKey}` in flight
  const [query, setQuery] = useState('');

  useEffect(() => {
    Promise.all([
      apiFetch<PermissionMatrixResponse>('/admin/role-permissions'),
      apiFetch<OverridesResponse>('/admin/role-nav-overrides'),
    ])
      .then(([p, o]) => {
        setPerms(p);
        setOverrides(o);
      })
      .catch((e) =>
        toast({
          kind: 'error',
          title: 'Failed to load sidebar visibility',
          body: apiErrorMessage(e, 'Please try again.'),
        }),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  // SUPER_ADMIN's sidebar can't be edited (see the routes module), so it renders
  // as an always-on, disabled column — same treatment as the permissions matrix
  // above it.
  const roles = perms?.roles ?? [];
  const editableRoles = overrides?.editableRoles ?? [];

  function isVisible(role: string, navKey: string, perm: string | null | undefined): boolean {
    if (role === 'SUPER_ADMIN') return true;
    const override = overrides?.overrides[role]?.[navKey];
    if (override !== undefined) return override;
    if (!perm) return true;
    return perms?.matrix[role]?.includes(perm) ?? false;
  }

  async function toggle(role: string, navKey: string, nextVisible: boolean) {
    if (!overrides) return;
    const cellId = `${role}:${navKey}`;
    setPending(cellId);
    const prevOverrides = overrides;
    // Optimistic update, same tradeoff as the permissions matrix: a wrong flash
    // from a rejected PATCH is cheaper than a full reload per click.
    setOverrides({
      ...overrides,
      overrides: {
        ...overrides.overrides,
        [role]: { ...overrides.overrides[role], [navKey]: nextVisible },
      },
    });
    try {
      await apiFetch('/admin/role-nav-overrides', {
        method: 'PATCH',
        body: JSON.stringify({ role, navKey, visible: nextVisible }),
      });
    } catch (e) {
      setOverrides(prevOverrides);
      toast({
        kind: 'error',
        title: 'Failed to update sidebar visibility',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setPending(null);
    }
  }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return navGroups
      .map((g) => ({
        ...g,
        items: q
          ? g.items.filter(
              (i) => i.label.toLowerCase().includes(q) || i.k.toLowerCase().includes(q),
            )
          : g.items,
      }))
      .filter((g) => g.items.length > 0);
  }, [query]);

  if (loading) return <p className="sub">Loading&hellip;</p>;
  if (!perms || !overrides) return null;

  return (
    <div>
      <p className="lede" style={{ marginBottom: 14 }}>
        Controls which sidebar sections and items each role sees — independent of the permissions
        above. Hiding an item here doesn't revoke a role's access to its data; pair it with the
        matching permission if you want both.
      </p>
      <div className="search" style={{ width: 300, marginBottom: 14 }}>
        <Icon.Search />
        <input
          placeholder="Filter sidebar items…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sidebar item</th>
              {roles.map((role) => (
                <th key={role} style={{ textAlign: 'center' }}>
                  {roleLabel(role)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.label || '__top__'}>
                <tr>
                  <td
                    colSpan={roles.length + 1}
                    style={{
                      background: 'var(--surface-2)',
                      padding: '6px 16px',
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--muted)',
                    }}
                  >
                    {group.label || 'Dashboard'}
                  </td>
                </tr>
                {group.items.map((item) => (
                  <tr key={item.k}>
                    <td>{item.label}</td>
                    {roles.map((role) => {
                      const editable = editableRoles.includes(role);
                      const checked = isVisible(role, item.k, item.perm);
                      return (
                        <td key={role} style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            className="cb"
                            checked={checked}
                            disabled={!editable || pending === `${role}:${item.k}`}
                            onChange={(e) => toggle(role, item.k, e.target.checked)}
                            title={editable ? undefined : 'Super Admin always sees every item'}
                            style={editable ? undefined : { opacity: 0.55, cursor: 'not-allowed' }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
            {groups.length === 0 && (
              <tr>
                <td colSpan={roles.length + 1} className="empty">
                  No sidebar items match "{query}".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
