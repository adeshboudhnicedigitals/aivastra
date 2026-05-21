import { useState } from 'react';
import { Icon } from '../components/Icons';
import { Switch } from '../components/Switch';
import { useAuth } from '../context/AuthContext';

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

const PAGE_SIZES = [15, 25, 50, 100] as const;

const CREDIT_PLANS = [
  { name: 'Starter', jobs: 100, price: 10, popular: false },
  { name: 'Growth', jobs: 500, price: 40, popular: true },
  { name: 'Scale', jobs: 2500, price: 150, popular: false },
  { name: 'Enterprise', jobs: -1, price: -1, popular: false },
];

export default function SettingsPage({ onNav: _onNav, toast, theme, onToggleTheme }: Props) {
  const { logout } = useAuth();
  const [pageSize, setPageSize] = useState<number>(25);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [slackWebhook, setSlackWebhook] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  const [adminUsers] = useState([
    { email: 'admin@aivastra.ai', role: 'SUPER_ADMIN', name: 'Alex Chen', mfa: true },
    { email: 'moderator@aivastra.ai', role: 'MODERATOR', name: 'Jordan Kim', mfa: false },
    { email: 'support@aivastra.ai', role: 'SUPPORT', name: 'Sam Rivera', mfa: true },
  ]);

  const save = (section: string) => {
    setSaving(section);
    setTimeout(() => {
      setSaving(null);
      toast({ title: `${section} saved` });
    }, 500);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="lede">Manage appearance, notifications, and administrative preferences.</p>
        </div>
      </div>

      {/* Appearance */}
      <div className="card settings-card">
        <div className="card-head">
          <h3><Icon.Settings /> Appearance</h3>
        </div>
        <div className="card-body">
          <div className="setting-row">
            <div>
              <div className="setting-lbl">Theme</div>
              <div className="setting-desc">Switch between light and dark mode.</div>
            </div>
            <button className="btn" onClick={onToggleTheme}>
              {theme === 'dark' ? <Icon.Sun /> : <Icon.Moon />}
              Switch to {theme === 'dark' ? 'light' : 'dark'} mode
            </button>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-lbl">Default page size</div>
              <div className="setting-desc">Items per page in tables.</div>
            </div>
            <select className="select" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} items</option>)}
            </select>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-lbl">Auto-refresh</div>
              <div className="setting-desc">Automatically refresh dashboard data.</div>
            </div>
            <Switch checked={autoRefresh} onChange={setAutoRefresh} />
          </div>

          {autoRefresh && (
            <div className="setting-row">
              <div>
                <div className="setting-lbl">Refresh interval</div>
                <div className="setting-desc">How often to poll for updates.</div>
              </div>
              <select className="select" value={refreshInterval} onChange={(e) => setRefreshInterval(Number(e.target.value))}>
                <option value={15}>15 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={60}>1 minute</option>
                <option value={300}>5 minutes</option>
              </select>
            </div>
          )}

          <div className="setting-actions">
            <button className="btn" onClick={() => save('Appearance')} disabled={saving !== null}>
              {saving === 'Appearance' ? <>Saving\u2026</> : <>Save appearance</>}
            </button>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="card settings-card">
        <div className="card-head">
          <h3><Icon.Bell /> Notifications</h3>
        </div>
        <div className="card-body">
          <div className="setting-row">
            <div>
              <div className="setting-lbl">Sound alerts</div>
              <div className="setting-desc">Play a sound on job failures and warnings.</div>
            </div>
            <Switch checked={soundEnabled} onChange={setSoundEnabled} />
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-lbl">Email alerts</div>
              <div className="setting-desc">Receive email notifications for critical events.</div>
            </div>
            <Switch checked={emailAlerts} onChange={setEmailAlerts} />
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-lbl">Slack webhook</div>
              <div className="setting-desc">Post job status updates to a Slack channel.</div>
            </div>
            <input
              className="input"
              style={{ width: 320 }}
              placeholder="https://hooks.slack.com/services/\u2026"
              value={slackWebhook}
              onChange={(e) => setSlackWebhook(e.target.value)}
            />
          </div>

          <div className="setting-actions">
            <button className="btn" onClick={() => save('Notifications')} disabled={saving !== null}>
              {saving === 'Notifications' ? <>Saving\u2026</> : <>Save notifications</>}
            </button>
          </div>
        </div>
      </div>

      {/* Credit Plans */}
      <div className="card settings-card">
        <div className="card-head">
          <h3><Icon.Coin /> Credit plans</h3>
          <div className="tools">
            <button className="btn sm"><Icon.Add /> Add plan</button>
          </div>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Jobs included</th>
                <th>Price</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {CREDIT_PLANS.map((p) => (
                <tr key={p.name}>
                  <td>
                    <span className="semi">{p.name}</span>
                    {p.popular && <span className="badge warn" style={{ marginLeft: 8 }}>Most popular</span>}
                  </td>
                  <td>{p.jobs === -1 ? 'Custom' : p.jobs.toLocaleString()}</td>
                  <td>{p.price === -1 ? 'Custom' : `$${p.price}/mo`}</td>
                  <td><span className="badge dot success">Active</span></td>
                  <td><button className="btn sm ghost"><Icon.Edit /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Admin Users */}
      <div className="card settings-card">
        <div className="card-head">
          <h3><Icon.Shield /> Admin users</h3>
          <div className="tools">
            <button className="btn sm"><Icon.Add /> Invite admin</button>
          </div>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>MFA</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {adminUsers.map((a) => (
                <tr key={a.email}>
                  <td><span className="semi">{a.name}</span></td>
                  <td><span className="mono">{a.email}</span></td>
                  <td><span className="badge dot">{a.role}</span></td>
                  <td>{a.mfa ? <span className="badge dot success">Enabled</span> : <span className="badge dot">Disabled</span>}</td>
                  <td>
                    <button className="btn sm ghost"><Icon.MoreHorizontal /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Session */}
      <div className="card settings-card">
        <div className="card-head">
          <h3><Icon.Logout /> Session</h3>
        </div>
        <div className="card-body">
          <div className="setting-row">
            <div>
              <div className="setting-lbl">Sign out</div>
              <div className="setting-desc">End your current admin session.</div>
            </div>
            <button className="btn danger" onClick={() => logout()}>
              <Icon.Logout /> Sign out
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
