import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icons';
import { apiErrorMessage, apiFetch } from '../../lib/data';

// The virtual try-on Android app's renewal popup (GET /v1/app/renewal-prompt).
// Lives in config:system rather than the app so switching it on, its start time and
// its wording never wait on a Play Store release.
interface RenewalPrompt {
  enabled: boolean;
  startsAt: string | null;
  blocking: boolean;
  title: string;
  message: string;
  ctaLabel: string;
  supportWhatsapp: string | null;
  supportEmail: string | null;
}

// <input type="datetime-local"> speaks local wall-clock time without a zone; the
// API stores an ISO instant. Convert at the edges only.
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function RenewalPopupTab({ toast }: Props) {
  const [cfg, setCfg] = useState<RenewalPrompt | null>(null);
  const [startsAtLocal, setStartsAtLocal] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ renewalPrompt: RenewalPrompt }>('/admin/config')
      .then((c) => {
        setCfg(c.renewalPrompt);
        setStartsAtLocal(toLocalInput(c.renewalPrompt.startsAt));
      })
      .catch((e) =>
        toast({
          kind: 'error',
          title: 'Failed to load renewal popup settings',
          body: apiErrorMessage(e, 'Please try again.'),
        }),
      );
  }, [toast]);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const next = {
        ...cfg,
        supportWhatsapp: cfg.supportWhatsapp?.trim() || null,
        supportEmail: cfg.supportEmail?.trim() || null,
        startsAt: startsAtLocal ? new Date(startsAtLocal).toISOString() : null,
      };
      await apiFetch('/admin/config', {
        method: 'PATCH',
        body: JSON.stringify({ renewalPrompt: next }),
      });
      setCfg(next);
      toast({ title: 'Renewal popup saved' });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to save renewal popup',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof RenewalPrompt>(k: K, v: RenewalPrompt[K]) =>
    setCfg((c) => (c ? { ...c, [k]: v } : c));

  return (
    <div className="card settings-card">
      <div className="card-head">
        <h3>
          <Icon.Credit /> Android renewal popup
        </h3>
      </div>
      <div className="card-body">
        {!cfg ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="setting-desc">
              Shown by the virtual try-on Android app on every launch to each user without an active
              monthly plan. The button opens the pricing page, where a user with an agreed price
              (Users → Monthly plan → Set agreed price) can pay it. Users without an agreed price
              only see the standard packs there — set prices before switching this on.
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={cfg.enabled}
                disabled={saving}
                onChange={(e) => set('enabled', e.target.checked)}
              />
              <span className="setting-lbl">Popup enabled</span>
            </label>
            <div className="field">
              <label>Start showing from</label>
              <input
                className="input"
                type="datetime-local"
                value={startsAtLocal}
                disabled={saving}
                onChange={(e) => setStartsAtLocal(e.target.value)}
              />
              <p className="hint">Your local time. Leave empty to show as soon as it's enabled.</p>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={cfg.blocking}
                disabled={saving}
                onChange={(e) => set('blocking', e.target.checked)}
              />
              <span className="setting-lbl">
                Blocking — no close button; the user can only renew or contact support
              </span>
            </label>
            <div className="field">
              <label>Title</label>
              <input
                className="input"
                maxLength={120}
                value={cfg.title}
                disabled={saving}
                onChange={(e) => set('title', e.target.value)}
              />
            </div>
            <div className="field">
              <label>Message</label>
              <textarea
                className="input"
                rows={3}
                maxLength={500}
                value={cfg.message}
                disabled={saving}
                onChange={(e) => set('message', e.target.value)}
              />
            </div>
            <div className="field">
              <label>Button label</label>
              <input
                className="input"
                maxLength={40}
                value={cfg.ctaLabel}
                disabled={saving}
                onChange={(e) => set('ctaLabel', e.target.value)}
              />
            </div>
            <div className="field">
              <label>Support WhatsApp</label>
              <input
                className="input"
                maxLength={30}
                placeholder="+91 7729883692 — leave empty to hide"
                value={cfg.supportWhatsapp ?? ''}
                disabled={saving}
                onChange={(e) => set('supportWhatsapp', e.target.value)}
              />
            </div>
            <div className="field">
              <label>Support email</label>
              <input
                className="input"
                type="email"
                maxLength={120}
                placeholder="support@aivastra.com — leave empty to hide"
                value={cfg.supportEmail ?? ''}
                disabled={saving}
                onChange={(e) => set('supportEmail', e.target.value)}
              />
              <p className="hint">
                Shown under "For any help, contact us". Both open WhatsApp / the mail app when
                tapped.
              </p>
            </div>
            <div>
              <button
                type="button"
                className="btn primary"
                disabled={
                  saving || !cfg.title.trim() || !cfg.message.trim() || !cfg.ctaLabel.trim()
                }
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
