'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ChevronDown,
  DownloadIcon,
  Eye,
  EyeOff,
  LogOutIcon,
  MoonIcon,
  SunIcon,
} from '@/components/icons';
import { C, grad } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { Tooltip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';

type Tab = 'Profile Details' | 'Billing' | 'Credit History' | 'Invoices';
const TABS: Tab[] = ['Profile Details', 'Billing', 'Credit History', 'Invoices'];

interface MeResponse {
  id: string;
  email: string;
  displayName: string | null;
  tier: string;
}
interface CreditsResponse {
  balance: number;
  recent: { id: string; delta: number; reason: string; createdAt: string }[];
}

// ── Field ────────────────────────────────────────────────
function Field({
  label,
  value,
  placeholder,
  type = 'text',
  dropdown,
  disabled,
  onChange,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  type?: string;
  dropdown?: boolean;
  disabled?: boolean;
  onChange?: (v: string) => void;
}) {
  const [internal, setInternal] = useState(value ?? '');
  const [show, setShow] = useState(false);
  const val = onChange ? (value ?? '') : internal;
  const inputId = `field-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 280 }}>
      <label htmlFor={inputId} style={{ fontWeight: 500, fontSize: 14, color: C.text }}>
        {label}
      </label>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input
          id={inputId}
          type={type === 'password' && show ? 'text' : type}
          value={val}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => (onChange ? onChange(e.target.value) : setInternal(e.target.value))}
          style={{
            width: '100%',
            height: 44,
            borderRadius: 8,
            background: C.field,
            border: `1px solid ${C.border}`,
            fontFamily: 'inherit',
            fontSize: 14,
            color: disabled ? C.light : C.mid,
            padding: dropdown || type === 'password' ? '0 36px 0 12px' : '0 12px',
            outline: 'none',
            appearance: 'none',
            cursor: disabled ? 'not-allowed' : 'text',
          }}
        />
        {dropdown && (
          <span
            style={{
              position: 'absolute',
              right: 12,
              pointerEvents: 'none',
              color: C.mid,
              display: 'flex',
            }}
          >
            <ChevronDown />
          </span>
        )}
        {type === 'password' && (
          <button
            type="button"
            onClick={() => setShow(!show)}
            style={{
              position: 'absolute',
              right: 12,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: C.mid,
              display: 'flex',
            }}
          >
            {show ? <EyeOff /> : <Eye />}
          </button>
        )}
      </div>
    </div>
  );
}

const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>{children}</div>
);

function Section({
  title,
  children,
  noBorder,
  badge,
}: {
  title: string;
  children: React.ReactNode;
  noBorder?: boolean;
  badge?: string;
}) {
  return (
    <div
      style={{ padding: '20px 24px', borderBottom: noBorder ? 'none' : `1px solid ${C.border}` }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <h3 style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{title}</h3>
        {badge && (
          <span
            style={{
              padding: '2px 10px',
              borderRadius: 99,
              fontSize: 11,
              fontWeight: 600,
              background: 'rgba(246,181,83,0.15)',
              color: C.amber,
            }}
          >
            {badge}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>{children}</div>
    </div>
  );
}

const fmtDate = (s: string) =>
  new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (s: string) =>
  new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

export default function SettingsPage(): React.ReactElement {
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('Profile Details');
  const [name, setName] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const [pwdSaved, setPwdSaved] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  useEffect(() => {
    setDarkMode(document.documentElement.classList.contains('dark'));
  }, []);

  function toggleTheme() {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  }

  const { data: me } = useQuery<MeResponse>({ queryKey: ['me'], queryFn: () => api.get('/v1/me') });
  const { data: credits } = useQuery<CreditsResponse>({
    queryKey: ['credits'],
    queryFn: () => api.get('/v1/credits'),
  });

  const email = me?.email ?? '';
  const nameVal = name ?? me?.displayName ?? '';

  const recent = credits?.recent ?? [];
  const purchased = recent.filter((r) => r.delta > 0).reduce((a, r) => a + r.delta, 0);
  const used = recent.filter((r) => r.delta < 0).reduce((a, r) => a + Math.abs(r.delta), 0);
  const remaining = credits?.balance ?? 0;

  async function saveProfile() {
    setSaving(true);
    try {
      await api.patch('/v1/me', { displayName: nameVal.trim() || undefined });
      void qc.invalidateQueries({ queryKey: ['me'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    setPwdError('');
    if (newPwd.length < 8) {
      setPwdError('New password must be at least 8 characters.');
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdError('Passwords do not match.');
      return;
    }
    setPwdSaving(true);
    try {
      await api.patch('/v1/me/password', { currentPassword: curPwd, newPassword: newPwd });
      setPwdSaved(true);
      setCurPwd('');
      setNewPwd('');
      setConfirmPwd('');
      setTimeout(() => setPwdSaved(false), 2500);
    } catch (e) {
      setPwdError((e as Error).message ?? 'Failed to update password.');
    } finally {
      setPwdSaving(false);
    }
  }

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const cardWrap: React.CSSProperties = {
    background: C.white,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  };

  return (
    <>
      <TopBar
        title="Account Settings"
        subtitle="Manage your profile, billing, credits, subscriptions, and account activity."
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={toggleTheme}
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '9px 16px',
                borderRadius: 8,
                border: `1px solid ${C.border2}`,
                background: C.white,
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                color: C.text,
              }}
            >
              {darkMode ? <SunIcon /> : <MoonIcon />}
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '9px 16px',
                borderRadius: 8,
                border: `1px solid ${C.border2}`,
                background: C.white,
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                color: C.text,
              }}
            >
              <LogOutIcon /> Log Out
            </button>
          </div>
        }
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, marginBottom: 20 }}>
          {TABS.map((t) => {
            const isActive = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '10px 20px',
                  border: 'none',
                  borderBottom: isActive ? `2px solid ${C.text}` : '2px solid transparent',
                  background: 'transparent',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? C.text : C.mid,
                  cursor: 'pointer',
                  marginBottom: -1,
                  whiteSpace: 'nowrap',
                }}
              >
                {t}
              </button>
            );
          })}
        </div>

        {tab === 'Profile Details' && (
          <div style={cardWrap}>
            <Section title="Personal Information">
              <Row>
                <Field label="Full Name" value={nameVal} onChange={setName} />
                <Field label="Email Address" value={email} disabled />
                <Field label="Phone Number" placeholder="Enter your phone number" />
              </Row>
              <Row>
                <Field label="Company Name" placeholder="Enter your company name" />
                <div style={{ flex: 1, minWidth: 280 }} />
                <div style={{ flex: 1, minWidth: 280 }} />
              </Row>
            </Section>
            <Section title="Account Preferences">
              <Row>
                <Field label="Default Resolution" value="HD" dropdown disabled />
                <Field label="Default Aspect Ratio" value="1:1" dropdown disabled />
                <Field label="Default Platform" value="Amazon" dropdown disabled />
              </Row>
            </Section>
            <Section title="Change Password" noBorder>
              <Row>
                <Field
                  label="Current Password"
                  placeholder="Enter current password"
                  type="password"
                  value={curPwd}
                  onChange={setCurPwd}
                />
                <Field
                  label="New Password"
                  placeholder="Enter new password (min 8 chars)"
                  type="password"
                  value={newPwd}
                  onChange={setNewPwd}
                />
                <Field
                  label="Confirm New Password"
                  placeholder="Re-enter new password"
                  type="password"
                  value={confirmPwd}
                  onChange={setConfirmPwd}
                />
              </Row>
              {pwdError && (
                <div style={{ fontSize: 13, color: '#E53935', marginTop: -8 }}>{pwdError}</div>
              )}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <Tooltip
                  tip={
                    !curPwd
                      ? 'Enter your current password'
                      : !newPwd
                        ? 'Enter a new password'
                        : !confirmPwd
                          ? 'Confirm your new password'
                          : undefined
                  }
                  position="top"
                >
                  <button
                    onClick={() => void changePassword()}
                    disabled={pwdSaving || !curPwd || !newPwd || !confirmPwd}
                    style={{
                      padding: '10px 24px',
                      borderRadius: 8,
                      border: 'none',
                      cursor:
                        pwdSaving || !curPwd || !newPwd || !confirmPwd ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit',
                      fontWeight: 600,
                      fontSize: 14,
                      color: C.white,
                      background: pwdSaved ? C.mint : grad,
                      opacity: pwdSaving || !curPwd || !newPwd || !confirmPwd ? 0.6 : 1,
                      transition: 'background .3s',
                    }}
                  >
                    {pwdSaved ? '✓ Password Updated!' : pwdSaving ? 'Updating…' : 'Update Password'}
                  </button>
                </Tooltip>
              </div>
            </Section>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 12,
                padding: '16px 24px',
                borderTop: `1px solid ${C.border}`,
                background: C.white,
              }}
            >
              <button
                onClick={saveProfile}
                disabled={saving}
                style={{
                  padding: '10px 24px',
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  fontSize: 14,
                  color: C.white,
                  background: saved ? C.mint : grad,
                  opacity: saving ? 0.6 : 1,
                  transition: 'background .3s',
                }}
              >
                {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Update Changes'}
              </button>
            </div>
          </div>
        )}

        {tab === 'Billing' && (
          <div style={cardWrap}>
            <Section title="Billing Details" badge="Coming soon">
              <Row>
                <Field label="Full Name" placeholder="Enter your full name" disabled />
                <Field label="Address" placeholder="Enter your address" disabled />
                <Field label="City" placeholder="Enter your city name" disabled />
              </Row>
              <Row>
                <Field label="State" placeholder="Enter your state" disabled />
                <Field label="Country" placeholder="Enter your country name" disabled />
                <Field label="Pincode" placeholder="Enter your pincode" disabled />
              </Row>
            </Section>
            <Section title="Payment Method" noBorder>
              <Row>
                <Field label="Select Payment Mode" value="Debit Card" dropdown disabled />
                <Field label="Card Number" placeholder="xxxx xxxx xxxx xxxx" disabled />
                <Field label="Expires On" placeholder="MM/YY" disabled />
              </Row>
            </Section>
          </div>
        )}

        {tab === 'Credit History' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {[
                {
                  label: 'Total Credits Purchased',
                  val: purchased.toLocaleString('en-IN'),
                  color: C.text,
                },
                { label: 'Credits Used', val: used.toLocaleString('en-IN'), color: C.pink },
                {
                  label: 'Credits Remaining',
                  val: remaining.toLocaleString('en-IN'),
                  color: C.mint,
                },
              ].map(({ label, val, color }) => (
                <div
                  key={label}
                  style={{
                    flex: 1,
                    minWidth: 200,
                    background: C.white,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: '18px 20px',
                  }}
                >
                  <div style={{ fontSize: 13, color: C.mid, marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color }}>{val}</div>
                </div>
              ))}
            </div>
            <div
              style={{
                background: C.white,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.5fr 2fr 1fr 1fr',
                  background: C.field,
                  borderBottom: `1px solid ${C.border}`,
                  padding: '14px 20px',
                }}
              >
                {['Date / Time', 'Activity', 'Credits', 'Status'].map((c) => (
                  <span key={c} style={{ fontSize: 13, fontWeight: 600, color: C.mid }}>
                    {c}
                  </span>
                ))}
              </div>
              {recent.length === 0 ? (
                <div
                  style={{ padding: '40px 24px', textAlign: 'center', color: C.mid, fontSize: 14 }}
                >
                  No activity yet.
                </div>
              ) : (
                recent.map((r, i) => {
                  const credit = r.delta > 0;
                  return (
                    <div
                      key={r.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1.5fr 2fr 1fr 1fr',
                        padding: '14px 20px',
                        borderBottom: i < recent.length - 1 ? `1px solid ${C.border}` : 'none',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>
                          {fmtDate(r.createdAt)}
                        </div>
                        <div style={{ fontSize: 11, color: C.light }}>{fmtTime(r.createdAt)}</div>
                      </div>
                      <span style={{ fontSize: 13, color: C.text }}>{r.reason}</span>
                      <span
                        style={{ fontSize: 13, fontWeight: 600, color: credit ? C.mint : C.pink }}
                      >
                        {credit ? '+' : ''}
                        {r.delta} Credits
                      </span>
                      <span>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 20,
                            fontSize: 12,
                            fontWeight: 500,
                            background: credit ? 'rgba(32,158,70,0.1)' : 'rgba(245,92,122,0.1)',
                            color: credit ? C.mint : C.pink,
                          }}
                        >
                          {credit ? 'Successful' : 'Used'}
                        </span>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {tab === 'Invoices' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {[
                { label: 'Total Spent', val: '—' },
                { label: 'Total Invoices', val: '0' },
                { label: 'Last Purchase', val: '—' },
              ].map(({ label, val }) => (
                <div
                  key={label}
                  style={{
                    flex: 1,
                    minWidth: 200,
                    background: C.white,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: '18px 20px',
                  }}
                >
                  <div style={{ fontSize: 13, color: C.mid, marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: C.text }}>{val}</div>
                </div>
              ))}
            </div>
            <div
              style={{
                background: C.white,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.4fr 1.2fr 2fr 1fr 1fr',
                  background: C.field,
                  borderBottom: `1px solid ${C.border}`,
                  padding: '14px 20px',
                }}
              >
                {['Invoice ID', 'Date', 'Purchase', 'Amount', 'Action'].map((c) => (
                  <span key={c} style={{ fontSize: 13, fontWeight: 600, color: C.mid }}>
                    {c}
                  </span>
                ))}
              </div>
              {/* TODO(wire): invoices endpoint not available yet */}
              <div
                style={{
                  padding: '40px 24px',
                  textAlign: 'center',
                  color: C.mid,
                  fontSize: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <DownloadIcon /> No invoices yet.
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
