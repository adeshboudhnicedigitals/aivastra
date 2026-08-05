import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/Icons';
import { JobTypeBadge } from '../components/JobTypeBadge';
import { KV } from '../components/KV';
import { NameAvatar } from '../components/NameAvatar';
import { Pager } from '../components/Pager';
import { SearchableSelect } from '../components/SearchableSelect';
import { StatusBadge } from '../components/StatusBadge';
import type { SortDir } from '../components/Th';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage, apiFetch } from '../lib/data';
import type { CreditPlan, User } from '../types';

const PAGE_SIZE = 20;

const EMPTY_GRANT_MERCHANT_FORM = {
  companyName: '',
  contactName: '',
  phone: '',
  businessAddress: '',
};
const EMPTY_EDIT_MERCHANT_FORM = {
  companyName: '',
  contactName: '',
  phone: '',
  businessAddress: '',
};
const EMPTY_CREATE_USER_FORM = {
  username: '',
  password: '',
  displayName: '',
  email: '',
  phone: '',
};

function adminRoleLabel(role: string | null) {
  if (role === 'SUPER_ADMIN') return 'Super Admin';
  if (role === 'MODERATOR') return 'Moderator';
  if (role === 'SUPPORT') return 'Support';
  return 'Admin';
}
function userLabel(u: {
  displayName: string | null;
  email: string | null;
  username: string | null;
}) {
  return u.displayName ?? u.email ?? u.username ?? 'User';
}
function userContact(u: { email: string | null; username: string | null }) {
  return u.email ?? (u.username ? `@${u.username}` : '\u2014');
}

interface Props {
  onNav: (
    _page: string,
    _filter?: { page: string; filter?: string; search?: string; jobId?: string },
  ) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function UsersPage({ onNav, toast }: Props) {
  const { role: myRole } = useAuth();
  const isSuperAdmin = myRole === 'SUPER_ADMIN';
  const [query, setQuery] = useState('');
  const [merchantsOnly, setMerchantsOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<keyof User>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<User | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState<string | null>(null);
  const [grantUserId, setGrantUserId] = useState<string | null>(null);
  const [grantMode, setGrantMode] = useState<'grant' | 'deduct'>('grant');
  const [grantAmount, setGrantAmount] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [granting, setGranting] = useState(false);
  const [adminActioning, setAdminActioning] = useState(false);
  const [tierOptions, setTierOptions] = useState<string[]>([]);
  const [selectedTier, setSelectedTier] = useState('');
  const [tierSaving, setTierSaving] = useState(false);
  const [selectedMaxDevices, setSelectedMaxDevices] = useState('1');
  const [deviceLimitSaving, setDeviceLimitSaving] = useState(false);
  const [editingAccountField, setEditingAccountField] = useState<'plan' | 'devices' | null>(null);
  const [showGrantMerchant, setShowGrantMerchant] = useState(false);
  const [grantMerchantForm, setGrantMerchantForm] = useState(EMPTY_GRANT_MERCHANT_FORM);
  const [grantingMerchant, setGrantingMerchant] = useState(false);
  const [showEditMerchant, setShowEditMerchant] = useState(false);
  const [merchantEditForm, setMerchantEditForm] = useState(EMPTY_EDIT_MERCHANT_FORM);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [savingMerchantEdit, setSavingMerchantEdit] = useState(false);
  const [togglingMerchant, setTogglingMerchant] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [createUserForm, setCreateUserForm] = useState(EMPTY_CREATE_USER_FORM);
  const [creatingUser, setCreatingUser] = useState(false);
  const [createUserError, setCreateUserError] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [expandedUserId, _setExpandedUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page + 1), pageSize: String(PAGE_SIZE) });
      if (query) params.set('search', query);
      if (merchantsOnly) params.set('merchant', 'true');
      const data = await apiFetch<{ items: User[]; total: number }>(`/admin/users?${params}`);
      setUsers(data.items);
      setTotal(data.total);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load users',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [page, query, merchantsOnly, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    apiFetch<CreditPlan[]>('/admin/credit-plans')
      .then((rows) => setTierOptions(rows.filter((plan) => plan.isActive).map((plan) => plan.slug)))
      .catch((e) =>
        toast({
          kind: 'error',
          title: 'Failed to load credit plan tiers',
          body: apiErrorMessage(e, 'Please try again.'),
        }),
      );
  }, [toast]);

  useEffect(() => {
    if (detail) window.scrollTo(0, 0);
  }, [detail]);

  const handleSearch = (q: string) => {
    setQuery(q);
    setPage(0);
  };

  const sorted = [...users].sort((a, b) => {
    const aVal = a[sortKey] ?? '';
    const bVal = b[sortKey] ?? '';
    const cmp =
      typeof aVal === 'string'
        ? aVal.localeCompare(bVal as string)
        : (aVal as number) - (bVal as number);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const openDetail = async (u: User) => {
    setDetail(u);
    setSelectedTier(u.tier);
    setSelectedMaxDevices(String(u.maxActiveDevices ?? 1));

    setDetailLoading(true);
    try {
      const full = await apiFetch<User>(`/admin/users/${u.id}`);
      setDetail(full);
      setSelectedTier(full.tier);
      setSelectedMaxDevices(String(full.maxActiveDevices ?? 1));
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load user detail',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setDetailLoading(false);
    }
  };

  const openAdjustCredits = () => {
    if (!detail) return;
    setGrantUserId(detail.id);
    setGrantMode('grant');
    setGrantAmount('');
    setGrantReason('');
  };

  const closeAdjustCredits = () => {
    setGrantUserId(null);
    setGrantMode('grant');
    setGrantAmount('');
    setGrantReason('');
  };

  const openPlanEditor = () => {
    if (!detail) return;
    setSelectedTier(detail.tier);
    setEditingAccountField('plan');
  };

  const openDeviceLimitEditor = () => {
    if (!detail) return;
    setSelectedMaxDevices(String(detail.maxActiveDevices ?? 1));
    setEditingAccountField('devices');
  };

  const closeAccountFieldEditor = () => {
    if (detail) {
      setSelectedTier(detail.tier);
      setSelectedMaxDevices(String(detail.maxActiveDevices ?? 1));
    }
    setEditingAccountField(null);
  };

  const handleSuspendConfirm = async () => {
    if (!confirmSuspend || !detail) return;
    const willBan = !detail.isBanned;
    if (detail.id.startsWith('usr_demo_')) {
      setDetail({ ...detail, isBanned: willBan });
      setUsers((prev) => prev.map((u) => (u.id === detail.id ? { ...u, isBanned: willBan } : u)));
      toast({ title: `User ${willBan ? 'suspended' : 'unsuspended'}` });
      setConfirmSuspend(null);
      return;
    }
    try {
      await apiFetch(`/admin/users/${detail.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isBanned: willBan }),
      });
      setDetail({ ...detail, isBanned: willBan });
      setUsers((prev) => prev.map((u) => (u.id === detail.id ? { ...u, isBanned: willBan } : u)));
      toast({ title: `User ${willBan ? 'suspended' : 'unsuspended'}` });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Action failed',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
    setConfirmSuspend(null);
  };

  const handleTierSave = async () => {
    if (!detail || !selectedTier || selectedTier === detail.tier) return;
    setTierSaving(true);
    if (detail.id.startsWith('usr_demo_')) {
      setDetail((prev) => (prev ? { ...prev, tier: selectedTier } : null));
      setUsers((prev) =>
        prev.map((user) => (user.id === detail.id ? { ...user, tier: selectedTier } : user)),
      );
      toast({ title: 'User tier updated' });
      setEditingAccountField(null);
      setTierSaving(false);
      return;
    }
    try {
      await apiFetch(`/admin/users/${detail.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ tier: selectedTier }),
      });
      setDetail((prev) => (prev ? { ...prev, tier: selectedTier } : null));
      setUsers((prev) =>
        prev.map((user) => (user.id === detail.id ? { ...user, tier: selectedTier } : user)),
      );
      toast({ title: 'User tier updated' });
      setEditingAccountField(null);
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to update tier',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setTierSaving(false);
    }
  };

  const handleDeviceLimitSave = async () => {
    if (!detail) return;
    const maxActiveDevices = parseInt(selectedMaxDevices, 10);
    if (Number.isNaN(maxActiveDevices) || maxActiveDevices < 1 || maxActiveDevices > 50) {
      toast({ kind: 'error', title: 'Device limit must be between 1 and 50' });
      return;
    }
    if (maxActiveDevices === detail.maxActiveDevices) return;
    setDeviceLimitSaving(true);
    if (detail.id.startsWith('usr_demo_')) {
      setDetail((prev) => (prev ? { ...prev, maxActiveDevices } : null));
      setUsers((prev) =>
        prev.map((user) => (user.id === detail.id ? { ...user, maxActiveDevices } : user)),
      );
      toast({ title: 'Device limit updated' });
      setEditingAccountField(null);
      setDeviceLimitSaving(false);
      return;
    }
    try {
      await apiFetch(`/admin/users/${detail.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ maxActiveDevices }),
      });
      setDetail((prev) => (prev ? { ...prev, maxActiveDevices } : null));
      setUsers((prev) =>
        prev.map((user) => (user.id === detail.id ? { ...user, maxActiveDevices } : user)),
      );
      toast({ title: 'Device limit updated' });
      setEditingAccountField(null);
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to update device limit',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setDeviceLimitSaving(false);
    }
  };

  const handleGrant = async () => {
    if (!grantUserId || !grantAmount) return;
    const amt = parseInt(grantAmount, 10);
    if (Number.isNaN(amt) || amt < 1) return;
    setGranting(true);
    try {
      if (grantMode === 'grant') {
        const body = {
          userId: grantUserId,
          amount: amt,
          reason: grantReason.trim() || 'Manual credit grant',
        };
        await apiFetch('/admin/credits/grant', { method: 'POST', body: JSON.stringify(body) });
        setDetail((prev) => (prev ? { ...prev, balance: prev.balance + amt } : null));
        setUsers((prev) =>
          prev.map((u) => (u.id === grantUserId ? { ...u, balance: u.balance + amt } : u)),
        );
        toast({ title: `Granted ${amt.toLocaleString()} credits` });
      } else {
        const body = {
          userId: grantUserId,
          amount: amt,
          reason: grantReason.trim() || 'Manual credit deduction',
        };
        await apiFetch('/admin/credits/deduct', { method: 'POST', body: JSON.stringify(body) });
        setDetail((prev) => (prev ? { ...prev, balance: prev.balance - amt } : null));
        setUsers((prev) =>
          prev.map((u) => (u.id === grantUserId ? { ...u, balance: u.balance - amt } : u)),
        );
        toast({ title: `Deducted ${amt.toLocaleString()} credits` });
      }
      closeAdjustCredits();
    } catch (err) {
      toast({
        kind: 'error',
        title: grantMode === 'grant' ? 'Failed to grant credits' : 'Failed to deduct credits',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setGranting(false);
    }
  };

  function openGrantMerchant() {
    setGrantMerchantForm(EMPTY_GRANT_MERCHANT_FORM);
    setShowGrantMerchant(true);
  }

  async function handleGrantMerchant() {
    if (!detail || !grantMerchantForm.companyName.trim()) return;
    setGrantingMerchant(true);
    try {
      await apiFetch('/admin/merchants', {
        method: 'POST',
        body: JSON.stringify({
          userId: detail.id,
          companyName: grantMerchantForm.companyName.trim(),
          contactName: grantMerchantForm.contactName.trim() || undefined,
          phone: grantMerchantForm.phone.trim() || undefined,
          businessAddress: grantMerchantForm.businessAddress.trim() || undefined,
        }),
      });
      toast({ title: `Merchant access granted to ${userLabel(detail)}` });
      setShowGrantMerchant(false);
      await openDetail(detail);
      setUsers((prev) => prev.map((u) => (u.id === detail.id ? { ...u, isMerchant: true } : u)));
    } catch (err) {
      toast({ kind: 'error', title: apiErrorMessage(err, 'Failed to grant merchant access') });
    } finally {
      setGrantingMerchant(false);
    }
  }

  function openEditMerchant() {
    if (!detail?.merchant) return;
    const m = detail.merchant;
    setMerchantEditForm({
      companyName: m.companyName,
      contactName: m.contactName,
      phone: m.phone,
      businessAddress: m.businessAddress,
    });
    setShowEditMerchant(true);
  }

  async function handleMerchantEditSave() {
    if (!detail?.merchant) return;
    setSavingMerchantEdit(true);
    try {
      await apiFetch(`/admin/merchants/${detail.merchant.id}`, {
        method: 'PATCH',
        body: JSON.stringify(merchantEditForm),
      });
      toast({ title: 'Merchant details updated' });
      setShowEditMerchant(false);
      await openDetail(detail);
    } catch (err) {
      toast({ kind: 'error', title: apiErrorMessage(err, 'Failed to update merchant') });
    } finally {
      setSavingMerchantEdit(false);
    }
  }
  async function handleLogoUpload(file: File) {
    if (!detail?.merchant) return;
    setUploadingLogo(true);
    try {
      const presign = await apiFetch<{ uploadUrl: string; logoKey: string }>(
        `/admin/merchants/${detail.merchant.id}/logo/presign`,
        { method: 'POST', body: JSON.stringify({ contentType: file.type }) },
      );
      await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      await apiFetch(`/admin/merchants/${detail.merchant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ logoKey: presign.logoKey }),
      });
      toast({ title: 'Merchant logo updated' });
      await openDetail(detail);
    } catch (err) {
      toast({ kind: 'error', title: apiErrorMessage(err, 'Failed to upload logo') });
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleToggleMerchantActive() {
    if (!detail?.merchant) return;
    setTogglingMerchant(true);
    try {
      await apiFetch(`/admin/merchants/${detail.merchant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !detail.merchant.isActive }),
      });
      toast({ title: `Merchant access ${detail.merchant.isActive ? 'revoked' : 'reactivated'}` });
      await openDetail(detail);
    } catch (err) {
      toast({ kind: 'error', title: apiErrorMessage(err, 'Failed to update merchant') });
    } finally {
      setTogglingMerchant(false);
    }
  }
  function openCreateUser() {
    setCreateUserForm(EMPTY_CREATE_USER_FORM);
    setCreateUserError('');
    setShowCreateUser(true);
  }

  async function handleCreateUser() {
    setCreateUserError('');
    if (
      !createUserForm.username.trim() ||
      !createUserForm.password ||
      !createUserForm.displayName.trim()
    ) {
      setCreateUserError('Username, password, and name are required.');
      return;
    }
    setCreatingUser(true);
    try {
      await apiFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: createUserForm.username.trim(),
          password: createUserForm.password,
          displayName: createUserForm.displayName.trim(),
          email: createUserForm.email.trim() || undefined,
          phone: createUserForm.phone.trim() || undefined,
        }),
      });
      toast({ title: `Account created for ${createUserForm.displayName.trim()}` });
      setShowCreateUser(false);
      setPage(0);
      await load();
    } catch (err) {
      setCreateUserError(apiErrorMessage(err, 'Failed to create user'));
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleResetPassword(newPassword: string) {
    if (!detail) return;
    await apiFetch(`/admin/users/${detail.id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    });
    toast({ title: 'Password reset \u2014 share the new password with the customer' });
  }

  if (detail) {
    const u = detail;
    const effectiveTierOptions =
      selectedTier && !tierOptions.includes(selectedTier)
        ? [selectedTier, ...tierOptions]
        : tierOptions;

    return (
      <>
        <div className="page-head">
          <div>
            <button className="btn ghost" onClick={() => setDetail(null)}>
              <Icon.Back /> Back to users
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
              <NameAvatar name={userLabel(u)} email={u.email ?? undefined} size={44} />
              <div>
                <h1 style={{ marginBottom: 2 }}>{userLabel(u)}</h1>
                <p className="lede" style={{ margin: 0 }}>
                  {userContact(u)}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
              {u.isAdmin && <span className="badge accent">{adminRoleLabel(u.adminRole)}</span>}
              {u.isMerchant && <span className="badge success">Merchant</span>}
              {u.hasShopifyStore && <span className="badge success">Shopify</span>}
              {!u.hasPassword && <span className="badge info">Google account</span>}
              {u.isBanned ? (
                <span className="badge danger dot">Suspended</span>
              ) : (
                <span className="badge success dot">Active</span>
              )}
            </div>
          </div>
          <div className="head-tools">
            <button
              className="btn ghost"
              onClick={() => {
                setNewPasswordInput('');
                setResettingPassword(true);
              }}
            >
              <Icon.Refresh /> Reset Password
            </button>
            {isSuperAdmin && !u.isAdmin && u.hasPassword && (
              <button
                className="btn ghost"
                disabled={adminActioning}
                onClick={async () => {
                  setAdminActioning(true);
                  try {
                    await apiFetch('/admin/admin-users', {
                      method: 'POST',
                      body: JSON.stringify({ userId: u.id, role: 'ADMIN' }),
                    });
                    setDetail((prev) => prev && { ...prev, isAdmin: true });
                    setUsers((prev) =>
                      prev.map((x) => (x.id === u.id ? { ...x, isAdmin: true } : x)),
                    );
                    toast({ title: `${userLabel(u)} granted admin access` });
                  } catch (e) {
                    toast({
                      kind: 'error',
                      title: 'Failed to grant admin access',
                      body: apiErrorMessage(e, 'Please try again.'),
                    });
                  } finally {
                    setAdminActioning(false);
                  }
                }}
              >
                <Icon.Check /> Grant admin
              </button>
            )}
            {isSuperAdmin && u.isAdmin && (
              <button
                className="btn ghost"
                disabled={adminActioning}
                onClick={async () => {
                  setAdminActioning(true);
                  if (u.id.startsWith('usr_demo_')) {
                    setDetail((prev) => prev && { ...prev, isAdmin: false });
                    setUsers((prev) =>
                      prev.map((x) => (x.id === u.id ? { ...x, isAdmin: false } : x)),
                    );
                    toast({ title: `${userLabel(u)} admin access revoked` });
                    setAdminActioning(false);
                    return;
                  }
                  try {
                    await apiFetch(`/admin/admin-users/${u.id}`, { method: 'DELETE' });
                    setDetail((prev) => prev && { ...prev, isAdmin: false });
                    setUsers((prev) =>
                      prev.map((x) => (x.id === u.id ? { ...x, isAdmin: false } : x)),
                    );
                    toast({ title: `${userLabel(u)} admin access revoked` });
                  } catch (e) {
                    toast({
                      kind: 'error',
                      title: 'Failed to revoke admin access',
                      body: apiErrorMessage(e, 'Please try again.'),
                    });
                  } finally {
                    setAdminActioning(false);
                  }
                }}
              >
                <Icon.Ban /> Revoke admin
              </button>
            )}
            {!u.isAdmin && (
              <button className="btn danger" onClick={() => setConfirmSuspend(u.id)}>
                <Icon.Ban /> {u.isBanned ? 'Unsuspend' : 'Suspend'}
              </button>
            )}
          </div>
        </div>

        {detailLoading ? (
          <p className="sub" style={{ textAlign: 'center', padding: '48px 0' }}>
            Loading user data&hellip;
          </p>
        ) : (
          <>
            <div className="stat-grid">
              <button className="stat" onClick={openPlanEditor} title="Change credit plan">
                <div className="lbl">
                  <Icon.Credit /> Current plan
                </div>
                <div className="val" style={{ textTransform: 'capitalize' }}>
                  {u.tier}
                </div>
                <div className="delta">
                  Change plan <Icon.Chevron />
                </div>
              </button>
              <button className="stat" onClick={openAdjustCredits} title="Adjust credits">
                <div className="lbl">
                  <Icon.Coin /> Credit balance
                </div>
                <div className="val">{u.balance.toLocaleString()}</div>
                <div className="delta">
                  Adjust credits <Icon.Chevron />
                </div>
              </button>
              <button
                className="stat"
                onClick={() => onNav('jobs', { page: 'jobs', search: u.email ?? u.username ?? '' })}
                title="View this user's jobs"
              >
                <div className="lbl">
                  <Icon.Activity /> Jobs generated
                </div>
                <div className="val">{(u.totalJobs ?? 0).toLocaleString()}</div>
              </button>
              <button
                className="stat"
                onClick={openDeviceLimitEditor}
                title="Change active device limit"
              >
                <div className="lbl">
                  <Icon.Monitor /> Device limit
                </div>
                <div className="val">{u.maxActiveDevices}</div>
                <div className="delta">
                  Change limit <Icon.Chevron />
                </div>
              </button>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Account details</h3>
              </div>
              <div className="card-body">
                <div className="kv-grid">
                  <KV k="Phone" v={u.phone ? `+91 ${u.phone}` : 'Not provided'} />
                  <KV
                    k="Authentication"
                    v={u.hasPassword ? 'Email and password' : 'Google account'}
                  />
                  <KV k="Joined" v={new Date(u.createdAt).toLocaleString()} />
                  <KV
                    k="Last job"
                    v={u.lastJobAt ? new Date(u.lastJobAt).toLocaleString() : 'No activity'}
                  />
                  <KV
                    k="User ID"
                    v={
                      <span title={u.id}>
                        {u.id.slice(0, 8)}…{u.id.slice(-6)}
                      </span>
                    }
                    mono
                  />
                  {u.isBanned && <KV k="Suspension" v={u.banReason || 'No reason provided'} />}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Merchant access</h3>
                {u.merchant && (
                  <div className="tools">
                    <button className="btn sm ghost" onClick={openEditMerchant}>
                      <Icon.Edit /> Edit
                    </button>
                    <button
                      className={`btn sm ${u.merchant.isActive ? 'danger' : 'primary'}`}
                      disabled={togglingMerchant}
                      onClick={() => void handleToggleMerchantActive()}
                    >
                      {togglingMerchant ? 'Saving…' : u.merchant.isActive ? 'Revoke' : 'Reactivate'}
                    </button>
                  </div>
                )}
              </div>
              <div className="card-body">
                {!u.merchant ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span
                      style={{
                        display: 'grid',
                        placeItems: 'center',
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        background: 'var(--surface-2)',
                        color: 'var(--muted-2)',
                        flexShrink: 0,
                      }}
                    >
                      <Icon.Shield />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="semi">No merchant access</div>
                      <div className="sub">
                        Grant access to seed a product catalogue for kiosk and mobile try-on.
                      </div>
                    </div>
                    <button className="btn primary" onClick={openGrantMerchant}>
                      Grant access
                    </button>
                  </div>
                ) : (
                  <div className="kv-grid">
                    <KV
                      k="Status"
                      v={<StatusBadge status={u.merchant.isActive ? 'active' : 'inactive'} />}
                    />
                    <KV k="Company" v={u.merchant.companyName} />
                    <KV k="Contact" v={u.merchant.contactName || '—'} />
                    <KV k="Phone" v={u.merchant.phone || '—'} />
                    <KV
                      k="Kiosk access"
                      v={
                        u.merchant.kioskEnabled
                          ? `Enabled (${u.merchant.maxKioskDevices})`
                          : 'Disabled'
                      }
                    />
                    <KV
                      k="Catalogue credits"
                      v={(u.merchant.creditBalance ?? 0).toLocaleString()}
                      mono
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-head">
                <div>
                  <h3>Recent activity</h3>
                  <span className="sub">Latest five generation jobs</span>
                </div>
                <button
                  className="btn sm ghost"
                  onClick={() =>
                    onNav('jobs', { page: 'jobs', search: u.email ?? u.username ?? '' })
                  }
                >
                  View all jobs <Icon.Chevron />
                </button>
              </div>
              <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Status</th>
                      <th>Credits</th>
                      <th>Created</th>
                      <th style={{ textAlign: 'right' }}>Duration</th>
                      <th aria-label="Open job"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.recentJobs?.length ? (
                      u.recentJobs.map((j) => (
                        <tr
                          key={j.id}
                          onClick={() => onNav('jobs', { page: 'jobs', search: j.id, jobId: j.id })}
                          style={{ cursor: 'pointer' }}
                          title="Open job details"
                        >
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <JobTypeBadge jobType={j.jobType} />
                              <span className="mono sub">{j.id.slice(0, 8)}&hellip;</span>
                            </div>
                          </td>
                          <td>
                            <StatusBadge status={j.status} />
                          </td>
                          <td>
                            <span className="mono">{j.creditsCharged.toLocaleString()}</span>
                          </td>
                          <td>{new Date(j.createdAt).toLocaleString()}</td>
                          <td style={{ textAlign: 'right' }}>
                            {j.completedAt && j.startedAt ? (
                              <span className="mono">
                                {(
                                  (new Date(j.completedAt).getTime() -
                                    new Date(j.startedAt).getTime()) /
                                  1000
                                ).toFixed(1)}
                                s
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            <span style={{ color: 'var(--muted-2)' }} aria-hidden="true">
                              <Icon.Chevron />
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={6}
                          style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}
                        >
                          No recent jobs.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {resettingPassword && (
          <div className="modal-overlay" onClick={() => setResettingPassword(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>Reset Password</h3>
              </div>
              <div className="modal-body">
                <div className="field">
                  <label>New password</label>
                  <input
                    className="input"
                    type="password"
                    value={newPasswordInput}
                    onChange={(e) => setNewPasswordInput(e.target.value)}
                    placeholder="At least 8 characters with a letter and number"
                  />
                </div>
              </div>
              <div className="modal-foot">
                <button className="btn ghost" onClick={() => setResettingPassword(false)}>
                  Cancel
                </button>
                <button
                  className="btn primary"
                  onClick={async () => {
                    await handleResetPassword(newPasswordInput);
                    setResettingPassword(false);
                  }}
                  disabled={!newPasswordInput}
                >
                  Reset Password
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmSuspend && (
          <div className="modal-overlay" onClick={() => setConfirmSuspend(null)}>
            <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>{u.isBanned ? 'Unsuspend' : 'Suspend'} user</h3>
              </div>
              <div className="modal-body">
                <p>
                  Are you sure you want to {u.isBanned ? 'unsuspend' : 'suspend'}{' '}
                  <strong>{userLabel(u)}</strong>?
                </p>
              </div>
              <div className="modal-foot">
                <button className="btn ghost" onClick={() => setConfirmSuspend(null)}>
                  Cancel
                </button>
                <button className="btn danger" onClick={handleSuspendConfirm}>
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {editingAccountField && (
          <div className="modal-overlay" onClick={closeAccountFieldEditor}>
            <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>
                  {editingAccountField === 'plan' ? 'Change credit plan' : 'Change device limit'}
                </h3>
              </div>
              <div className="modal-body">
                {editingAccountField === 'plan' ? (
                  <div className="field">
                    <label htmlFor="user-credit-plan">Credit plan</label>
                    <SearchableSelect
                      id="user-credit-plan"
                      options={effectiveTierOptions.map((slug) => ({ id: slug, label: slug }))}
                      value={selectedTier}
                      disabled={tierSaving}
                      placeholder="— search plan —"
                      onChange={setSelectedTier}
                    />
                    <span className="hint">
                      This changes the account's pricing and credit-plan entitlement.
                    </span>
                  </div>
                ) : (
                  <div className="field">
                    <label htmlFor="user-device-limit">Active device limit</label>
                    <input
                      id="user-device-limit"
                      className="input"
                      type="number"
                      min={1}
                      max={50}
                      value={selectedMaxDevices}
                      disabled={deviceLimitSaving}
                      onChange={(e) => setSelectedMaxDevices(e.target.value)}
                    />
                    <span className="hint">Enter a value between 1 and 50 devices.</span>
                  </div>
                )}
              </div>
              <div className="modal-foot">
                <button
                  className="btn ghost"
                  onClick={closeAccountFieldEditor}
                  disabled={tierSaving || deviceLimitSaving}
                >
                  Cancel
                </button>
                <button
                  className="btn primary"
                  onClick={editingAccountField === 'plan' ? handleTierSave : handleDeviceLimitSave}
                  disabled={
                    editingAccountField === 'plan'
                      ? tierSaving || !selectedTier || selectedTier === u.tier
                      : deviceLimitSaving ||
                        !selectedMaxDevices ||
                        parseInt(selectedMaxDevices, 10) === u.maxActiveDevices
                  }
                >
                  {tierSaving || deviceLimitSaving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {grantUserId && (
          <div className="modal-overlay" onClick={closeAdjustCredits}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>Adjust credits — {userLabel(u)}</h3>
              </div>
              <div
                className="modal-body"
                style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
              >
                <div className="field">
                  <label>Action</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className={`btn${grantMode === 'grant' ? ' primary' : ' ghost'}`}
                      style={{ flex: 1 }}
                      onClick={() => setGrantMode('grant')}
                    >
                      + Grant
                    </button>
                    <button
                      type="button"
                      className={`btn${grantMode === 'deduct' ? ' danger' : ' ghost'}`}
                      style={{ flex: 1 }}
                      onClick={() => setGrantMode('deduct')}
                    >
                      − Deduct
                    </button>
                  </div>
                </div>
                <div className="field">
                  <label>Amount</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={10000}
                    value={grantAmount}
                    onChange={(e) => setGrantAmount(e.target.value)}
                    placeholder={
                      grantMode === 'grant'
                        ? 'Credits to add (max 10,000)'
                        : `Credits to remove (max ${u.balance.toLocaleString()})`
                    }
                  />
                  {grantMode === 'deduct' && (
                    <p className="hint">Current balance: {u.balance.toLocaleString()} credits</p>
                  )}
                </div>
                <div className="field">
                  <label>Reason</label>
                  <textarea
                    className="input"
                    value={grantReason}
                    onChange={(e) => setGrantReason(e.target.value)}
                    placeholder={
                      grantMode === 'grant'
                        ? 'e.g. Customer support, bulk top-up'
                        : 'e.g. Refund correction, duplicate charge'
                    }
                    rows={3}
                  />
                </div>
              </div>
              <div className="modal-foot">
                <button className="btn ghost" onClick={closeAdjustCredits}>
                  Cancel
                </button>
                <button
                  className={`btn ${grantMode === 'grant' ? 'primary' : 'danger'}`}
                  onClick={handleGrant}
                  disabled={granting || !grantAmount || parseInt(grantAmount, 10) < 1}
                >
                  {granting
                    ? grantMode === 'grant'
                      ? 'Granting…'
                      : 'Deducting…'
                    : grantMode === 'grant'
                      ? `Grant ${grantAmount ? parseInt(grantAmount, 10).toLocaleString() : ''} credits`
                      : `Deduct ${grantAmount ? parseInt(grantAmount, 10).toLocaleString() : ''} credits`}
                </button>
              </div>
            </div>
          </div>
        )}

        {showGrantMerchant && (
          <div className="modal-overlay" onClick={() => setShowGrantMerchant(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>Grant merchant access — {userLabel(u)}</h3>
              </div>
              <div
                className="modal-body"
                style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
              >
                <div className="field">
                  <label>Company name</label>
                  <input
                    className="input"
                    value={grantMerchantForm.companyName}
                    onChange={(e) =>
                      setGrantMerchantForm((f) => ({ ...f, companyName: e.target.value }))
                    }
                    placeholder="e.g. XYZ Family Mall"
                  />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Contact name</label>
                    <input
                      className="input"
                      value={grantMerchantForm.contactName}
                      onChange={(e) =>
                        setGrantMerchantForm((f) => ({ ...f, contactName: e.target.value }))
                      }
                      placeholder="Optional — defaults to account name"
                    />
                  </div>
                  <div className="field">
                    <label>Phone</label>
                    <input
                      className="input"
                      value={grantMerchantForm.phone}
                      onChange={(e) =>
                        setGrantMerchantForm((f) => ({ ...f, phone: e.target.value }))
                      }
                      placeholder="Optional"
                    />
                  </div>
                </div>
                <div className="field">
                  <label>Business address</label>
                  <input
                    className="input"
                    value={grantMerchantForm.businessAddress}
                    onChange={(e) =>
                      setGrantMerchantForm((f) => ({ ...f, businessAddress: e.target.value }))
                    }
                    placeholder="Optional — can be filled in later via Edit"
                  />
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: 0 }}>
                  This instantly grants {userContact(u)} access to the catalogue manager, using
                  their existing login.
                </p>
              </div>
              <div className="modal-foot">
                <button className="btn ghost" onClick={() => setShowGrantMerchant(false)}>
                  Cancel
                </button>
                <button
                  className="btn primary"
                  onClick={() => void handleGrantMerchant()}
                  disabled={grantingMerchant || !grantMerchantForm.companyName.trim()}
                >
                  {grantingMerchant ? 'Granting…' : 'Grant access'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showEditMerchant && u.merchant && (
          <div className="modal-overlay" onClick={() => setShowEditMerchant(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>Edit merchant details</h3>
              </div>
              <div
                className="modal-body"
                style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
              >
                <div className="field">
                  <label>Logo</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {detail.merchant?.logoUrl && (
                      // biome-ignore lint/performance/noImgElement: admin SPA, not Next.js
                      <img
                        src={detail.merchant.logoUrl}
                        alt="Merchant logo"
                        style={{
                          width: 48,
                          height: 48,
                          objectFit: 'contain',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                        }}
                      />
                    )}
                    <label className="btn sm ghost" style={{ cursor: 'pointer' }}>
                      {uploadingLogo ? 'Uploading…' : 'Upload logo'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        style={{ display: 'none' }}
                        disabled={uploadingLogo}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleLogoUpload(file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                </div>
                <div className="field">
                  <label>Company name</label>
                  <input
                    className="input"
                    value={merchantEditForm.companyName}
                    onChange={(e) =>
                      setMerchantEditForm((f) => ({ ...f, companyName: e.target.value }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Contact name</label>
                  <input
                    className="input"
                    value={merchantEditForm.contactName}
                    onChange={(e) =>
                      setMerchantEditForm((f) => ({ ...f, contactName: e.target.value }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Phone</label>
                  <input
                    className="input"
                    value={merchantEditForm.phone}
                    onChange={(e) => setMerchantEditForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>Business address</label>
                  <input
                    className="input"
                    value={merchantEditForm.businessAddress}
                    onChange={(e) =>
                      setMerchantEditForm((f) => ({ ...f, businessAddress: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="modal-foot">
                <button className="btn ghost" onClick={() => setShowEditMerchant(false)}>
                  Cancel
                </button>
                <button
                  className="btn primary"
                  onClick={() => void handleMerchantEditSave()}
                  disabled={savingMerchantEdit}
                >
                  {savingMerchantEdit ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p className="lede">
            {loading ? 'Loading…' : `${total.toLocaleString()} accounts`} — manage access, credit
            plans, and merchant catalogue permissions.
          </p>
        </div>
        <div className="head-tools">
          <div className="search">
            <Icon.Search />
            <input
              placeholder="Search by name, email, or username…"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span
              className="sub"
              style={{ fontSize: 13, whiteSpace: 'nowrap', color: 'var(--muted)' }}
            >
              Sort by:
            </span>
            <select
              value={`${sortKey}-${sortDir}`}
              onChange={(e) => {
                const [key, dir] = e.target.value.split('-');
                setSortKey(key as keyof User);
                setSortDir(dir as SortDir);
              }}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--ink)',
                fontSize: 13,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="createdAt-desc">Newest Joined</option>
              <option value="createdAt-asc">Oldest Joined</option>
              <option value="displayName-asc">Name (A-Z)</option>
              <option value="displayName-desc">Name (Z-A)</option>
              <option value="balance-desc">Highest Credits</option>
              <option value="balance-asc">Lowest Credits</option>
              <option value="totalJobs-desc">Most Jobs</option>
              <option value="lastJobAt-desc">Recent Activity</option>
            </select>
          </div>

          <button className="btn" onClick={openCreateUser}>
            <Icon.Plus /> Create User
          </button>
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${!merchantsOnly ? 'active' : ''}`}
          onClick={() => {
            setMerchantsOnly(false);
            setPage(0);
          }}
        >
          All users
        </button>
        <button
          className={`tab ${merchantsOnly ? 'active' : ''}`}
          onClick={() => {
            setMerchantsOnly(true);
            setPage(0);
          }}
        >
          Merchants
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>
          Loading users&hellip;
        </p>
      ) : (
        <>
          {/* ── Desktop table ───────────────────────────────────── */}
          <div className="desktop-only table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Plan</th>
                  <th>Balance</th>
                  <th>Jobs</th>
                  <th>Joined</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => void openDetail(u)}
                    style={{ cursor: 'pointer', opacity: u.isBanned ? 0.55 : 1 }}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <NameAvatar name={userLabel(u)} email={u.email ?? undefined} size={32} />
                        <div>
                          <div className="semi" style={{ fontSize: 14 }}>
                            {userLabel(u)}
                          </div>
                          <div className="sub" style={{ fontSize: 11 }}>
                            {userContact(u)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ textTransform: 'capitalize', fontSize: 13 }}>{u.tier}</span>
                    </td>
                    <td>
                      <span className="mono">{u.balance.toLocaleString()}</span>
                    </td>
                    <td>
                      <span className="mono">{(u.totalJobs ?? 0).toLocaleString()}</span>
                    </td>
                    <td>
                      <span className="sub" style={{ fontSize: 13 }}>
                        {new Date(u.createdAt).toLocaleDateString()}
                      </span>
                    </td>
                    <td>
                      {u.isBanned ? (
                        <span className="badge danger dot">Suspended</span>
                      ) : (
                        <span className="badge success dot">Active</span>
                      )}
                    </td>
                    <td>
                      <span style={{ color: 'var(--muted-2)', display: 'inline-flex' }}>
                        <Icon.Chevron />
                      </span>
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}
                    >
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Mobile/Tablet accordion cards ────────────────────── */}
          <div className="mobile-only">
            {sorted.map((u) => {
              const isExpanded = expandedUserId === u.id;
              return (
                <div
                  key={u.id}
                  className="card"
                  style={{
                    padding: 0,
                    overflow: 'hidden',
                    opacity: u.isBanned ? 0.6 : 1,
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--surface)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void openDetail(u)}
                    style={{
                      padding: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      userSelect: 'none',
                      background: 'none',
                      border: 'none',
                      width: '100%',
                      textAlign: 'left',
                      color: 'inherit',
                      fontFamily: 'inherit',
                      fontSize: 'inherit',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <NameAvatar name={userLabel(u)} email={u.email ?? undefined} size={32} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          className="semi"
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontSize: 14,
                          }}
                        >
                          {userLabel(u)}
                        </div>
                        {u.displayName && (
                          <div
                            className="sub"
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontSize: 11,
                              color: 'var(--muted)',
                            }}
                          >
                            {userContact(u)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                      {u.isBanned ? (
                        <span className="badge danger dot">Suspended</span>
                      ) : (
                        <span className="badge success dot">Active</span>
                      )}
                      <span
                        style={{
                          color: 'var(--muted-2)',
                          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s',
                          display: 'inline-flex',
                        }}
                      >
                        <Icon.Chevron />
                      </span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div
                      style={{
                        padding: '12px',
                        borderTop: '1px solid var(--border)',
                        background: 'var(--bg-2, #fafafa)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                        fontSize: 13,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ color: 'var(--muted)', fontWeight: 500 }}>Plan</span>
                        <span className="badge" style={{ textTransform: 'capitalize' }}>
                          {u.tier}
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ color: 'var(--muted)', fontWeight: 500 }}>Access</span>
                        <div
                          style={{
                            display: 'flex',
                            gap: 4,
                            flexWrap: 'wrap',
                            justifyContent: 'flex-end',
                          }}
                        >
                          {u.isAdmin && (
                            <span className="badge accent">
                              {u.adminRole === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin'}
                            </span>
                          )}
                          {u.isMerchant && <span className="badge success">Merchant</span>}
                          {u.hasShopifyStore && <span className="badge success">Shopify</span>}
                          {!u.hasPassword && <span className="badge info">Google</span>}
                          {!u.isAdmin && !u.isMerchant && u.hasPassword && (
                            <span className="sub" style={{ fontSize: 11 }}>
                              Standard
                            </span>
                          )}
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ color: 'var(--muted)', fontWeight: 500 }}>Credits</span>
                        <span
                          className="mono"
                          style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
                        >
                          {u.balance.toLocaleString()}
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ color: 'var(--muted)', fontWeight: 500 }}>Jobs</span>
                        <span className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {(u.totalJobs ?? 0).toLocaleString()}
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ color: 'var(--muted)', fontWeight: 500 }}>
                          Last activity
                        </span>
                        <span className="sub">
                          {u.lastJobAt ? new Date(u.lastJobAt).toLocaleDateString() : 'No activity'}
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ color: 'var(--muted)', fontWeight: 500 }}>Joined</span>
                        <span className="sub">{new Date(u.createdAt).toLocaleDateString()}</span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                        <button
                          className="btn sm primary"
                          onClick={() => openDetail(u)}
                          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          <Icon.User /> Manage Account
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {sorted.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  color: 'var(--muted)',
                  padding: '2.5rem',
                  border: '1.5px dashed var(--border)',
                  borderRadius: 8,
                }}
              >
                No users found.
              </div>
            )}
          </div>

          <Pager
            page={page}
            totalPages={totalPages}
            onPage={setPage}
            totalItems={total}
            pageSize={PAGE_SIZE}
          />
        </>
      )}
      {showCreateUser && (
        <div className="modal-overlay" onClick={() => setShowCreateUser(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Create User</h3>
            </div>
            <div
              className="modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: 0 }}>
                Give the account a username and password now. Email and phone are optional here —
                the customer will be prompted to add them the first time they log in.
              </p>
              {createUserError && (
                <div className="banner warn">
                  <p style={{ margin: 0, fontSize: 13 }}>{createUserError}</p>
                </div>
              )}
              <div className="field">
                <label>Username</label>
                <input
                  className="input"
                  value={createUserForm.username}
                  onChange={(e) => setCreateUserForm((f) => ({ ...f, username: e.target.value }))}
                  placeholder="e.g. priya_shop1"
                />
              </div>
              <div className="field">
                <label>Password</label>
                <input
                  className="input"
                  value={createUserForm.password}
                  onChange={(e) => setCreateUserForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="Share this with the customer directly"
                />
              </div>
              <div className="field">
                <label>Full name</label>
                <input
                  className="input"
                  value={createUserForm.displayName}
                  onChange={(e) =>
                    setCreateUserForm((f) => ({ ...f, displayName: e.target.value }))
                  }
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Email</label>
                  <input
                    className="input"
                    value={createUserForm.email}
                    onChange={(e) => setCreateUserForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="Optional"
                  />
                </div>
                <div className="field">
                  <label>Phone</label>
                  <input
                    className="input"
                    value={createUserForm.phone}
                    onChange={(e) => setCreateUserForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="Optional — 10-digit mobile number"
                  />
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => setShowCreateUser(false)}
                disabled={creatingUser}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={() => void handleCreateUser()}
                disabled={creatingUser}
              >
                {creatingUser ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
