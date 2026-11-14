import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icons';
import { apiErrorMessage, apiFetch } from '../../lib/data';

// The virtual try-on Android app's "Update available" popup (GET /v1/app/update-prompt).
// The app sends its versionCode and the server compares it with latestVersionCode, so
// the target build, the on/off switch and the wording never wait on a Play Store release.
interface AndroidUpdate {
  enabled: boolean;
  latestVersionCode: number;
  title: string;
  message: string;
  ctaLabel: string;
}

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function AndroidUpdateTab({ toast }: Props) {
  const [cfg, setCfg] = useState<AndroidUpdate | null>(null);
  // Held as text so the field can be cleared while typing; parsed on save.
  const [codeText, setCodeText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ androidUpdate: AndroidUpdate }>('/admin/config')
      .then((c) => {
        setCfg(c.androidUpdate);
        setCodeText(String(c.androidUpdate.latestVersionCode));
      })
      .catch((e) =>
        toast({
          kind: 'error',
          title: 'Failed to load app update settings',
          body: apiErrorMessage(e, 'Please try again.'),
        }),
      );
  }, [toast]);

  const codeValid = /^\d{1,10}$/.test(codeText.trim()) && Number(codeText) <= 2_100_000_000;

  const save = async () => {
    if (!cfg || !codeValid) return;
    setSaving(true);
    try {
      const next = { ...cfg, latestVersionCode: Number(codeText) };
      await apiFetch('/admin/config', {
        method: 'PATCH',
        body: JSON.stringify({ androidUpdate: next }),
      });
      setCfg(next);
      toast({ title: 'App update popup saved' });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to save app update popup',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof AndroidUpdate>(k: K, v: AndroidUpdate[K]) =>
    setCfg((c) => (c ? { ...c, [k]: v } : c));

  return (
    <div className="card settings-card">
      <div className="card-head">
        <h3>
          <Icon.Credit /> Android app update popup
        </h3>
      </div>
      <div className="card-body">
        {!cfg ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="setting-desc">
              On every launch the virtual try-on Android app sends its version code. If it is lower
              than the latest version code below, the app shows this popup and its button opens the
              Play Store listing. Users can dismiss it, and it returns on the next launch. Set the
              latest version code only after that build is live on Play for your users — otherwise
              they are told to update to something they cannot get.
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
              <label>Latest version code</label>
              <input
                className="input"
                inputMode="numeric"
                maxLength={10}
                value={codeText}
                disabled={saving}
                onChange={(e) => setCodeText(e.target.value)}
              />
              <p className="hint">
                The integer versionCode of the newest Play release (the number in
                app/build.gradle.kts, not the 1.0.x name). Apps below it see the popup.
              </p>
            </div>
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
            <div>
              <button
                type="button"
                className="btn primary"
                disabled={
                  saving ||
                  !codeValid ||
                  !cfg.title.trim() ||
                  !cfg.message.trim() ||
                  !cfg.ctaLabel.trim()
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
