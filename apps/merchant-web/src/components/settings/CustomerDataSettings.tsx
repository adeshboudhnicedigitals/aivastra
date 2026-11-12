'use client';
import type {
  CrmSettingsPutBody,
  CrmSettingsResponse,
  WhatsappChannelResponse,
} from '@aivastra/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { C } from '@/components/tokens';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PremiumSelect } from '@/components/ui/premium-select';
import { ListState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { blockerText, type ChannelDraft, parseRetention, validateChannel } from '@/lib/crm-form';

// CRM phase 2 (spec §4.1 A2, §3): the brand connects its own WhatsApp Business number and
// chooses how long customer data is kept. Shoppers can only be identified once both are done.

const CHANNEL_KEY = ['merchant', 'whatsapp-channel'];
const CRM_KEY = ['merchant', 'crm-settings'];

const card: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
};
const heading: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: C.text, margin: 0 };
const help: React.CSSProperties = { fontSize: 12, color: C.light, marginTop: 6 };
const field = (invalid: boolean): React.CSSProperties => ({
  width: '100%',
  height: 40,
  padding: '0 12px',
  borderRadius: 8,
  border: `1px solid ${invalid ? C.danger : C.border2}`,
  background: C.field,
  color: C.text,
  fontFamily: 'inherit',
  fontSize: 14,
  boxSizing: 'border-box',
  minWidth: 0,
});
const btn = (primary?: boolean): React.CSSProperties => ({
  height: 36,
  padding: '0 14px',
  borderRadius: 8,
  border: primary ? 'none' : `1px solid ${C.border2}`,
  background: primary ? C.btnPrimary : C.white,
  color: primary ? C.white : C.text,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
});

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <label htmlFor={id} style={{ fontSize: 13, color: C.mid }}>
        {label}
      </label>
      {children}
      {error && (
        <div id={`${id}-err`} role="alert" style={{ color: C.danger, fontSize: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function WhatsappChannelCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const channel = useQuery({
    queryKey: CHANNEL_KEY,
    queryFn: () => apiFetch<WhatsappChannelResponse>('/v1/merchant/whatsapp-channel'),
  });
  const empty: ChannelDraft = { wabaId: '', phoneNumberId: '', accessToken: '', appSecret: '' };
  const [draft, setDraft] = useState<ChannelDraft>(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof ChannelDraft, string>>>({});
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const done = (next: WhatsappChannelResponse | null) => {
    qc.setQueryData(CHANNEL_KEY, next ?? undefined);
    void qc.invalidateQueries({ queryKey: CHANNEL_KEY });
    void qc.invalidateQueries({ queryKey: CRM_KEY });
  };
  const save = useMutation({
    mutationFn: (d: ChannelDraft) =>
      apiFetch<WhatsappChannelResponse>('/v1/merchant/whatsapp-channel', {
        method: 'PUT',
        body: JSON.stringify({
          wabaId: d.wabaId.trim(),
          phoneNumberId: d.phoneNumberId.trim(),
          accessToken: d.accessToken.trim(),
          appSecret: d.appSecret.trim(),
        }),
      }),
    onSuccess: (next) => {
      done(next);
      setDraft(empty);
      setEditing(false);
      toast.show('WhatsApp number connected', 'success');
    },
    onError: (e: unknown) =>
      toast.show(e instanceof Error ? e.message : 'The request could not be completed.'),
  });
  const remove = useMutation({
    mutationFn: () => apiFetch<void>('/v1/merchant/whatsapp-channel', { method: 'DELETE' }),
    onSuccess: () => {
      done(null);
      setConfirmRemove(false);
      toast.show('WhatsApp number disconnected', 'success');
    },
    onError: (e: unknown) =>
      toast.show(e instanceof Error ? e.message : 'The request could not be completed.'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateChannel(draft);
    setErrors(errs);
    if (Object.keys(errs).length === 0) save.mutate(draft);
  };
  const c = channel.data;
  const set = (k: keyof ChannelDraft) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft({ ...draft, [k]: e.target.value });
    setErrors({ ...errors, [k]: undefined });
  };
  const input = (k: keyof ChannelDraft, secret = false) => (
    <input
      id={`wa-${k}`}
      type={secret ? 'password' : 'text'}
      inputMode={secret ? undefined : 'numeric'}
      autoComplete="off"
      value={draft[k]}
      onChange={set(k)}
      aria-invalid={errors[k] ? true : undefined}
      aria-describedby={errors[k] ? `wa-${k}-err` : undefined}
      style={field(!!errors[k])}
    />
  );

  return (
    <section style={card} aria-labelledby="wa-heading">
      <h2 id="wa-heading" style={heading}>
        WhatsApp Business number
      </h2>
      <div style={help}>
        Shoppers get their try-on looks from your own number, and become your customers.
      </div>
      <ListState
        status={channel.status}
        isEmpty={false}
        emptyText=""
        error="Could not load the WhatsApp connection."
        onRetry={() => void channel.refetch()}
      >
        {c?.connected && !editing ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>+{c.displayNumber}</div>
            <div style={help}>
              Phone number ID {c.phoneNumberId} · connected{' '}
              {c.connectedAt ? new Date(c.connectedAt).toLocaleDateString('en-IN') : ''}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button type="button" style={btn()} onClick={() => setEditing(true)}>
                Replace credentials
              </button>
              <button type="button" style={btn()} onClick={() => setConfirmRemove(true)}>
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} style={{ marginTop: 12, display: 'grid', gap: 12 }}>
            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              }}
            >
              <Field id="wa-wabaId" label="WhatsApp Business Account ID" error={errors.wabaId}>
                {input('wabaId')}
              </Field>
              <Field id="wa-phoneNumberId" label="Phone number ID" error={errors.phoneNumberId}>
                {input('phoneNumberId')}
              </Field>
              <Field id="wa-accessToken" label="Permanent access token" error={errors.accessToken}>
                {input('accessToken', true)}
              </Field>
              <Field id="wa-appSecret" label="App secret" error={errors.appSecret}>
                {input('appSecret', true)}
              </Field>
            </div>
            <div style={help}>
              From Meta Business Manager. The token and secret are encrypted and never shown again.
              We check them with WhatsApp before saving.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="submit" disabled={save.isPending} style={btn(true)}>
                {save.isPending ? 'Checking with WhatsApp...' : 'Connect'}
              </button>
              {c?.connected && (
                <button type="button" style={btn()} onClick={() => setEditing(false)}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}
      </ListState>
      <ConfirmDialog
        open={confirmRemove}
        title="Disconnect WhatsApp?"
        body="Shoppers can no longer get looks on WhatsApp. Customers you already have stay yours."
        confirmLabel="Disconnect"
        danger
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmRemove(false)}
      />
    </section>
  );
}

function CustomerDataCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({
    queryKey: CRM_KEY,
    queryFn: () => apiFetch<CrmSettingsResponse>('/v1/merchant/crm-settings'),
  });
  const s = settings.data;
  return (
    <section style={card} aria-labelledby="crm-heading">
      <h2 id="crm-heading" style={heading}>
        Customer data
      </h2>
      <div style={help}>
        You decide how long shopper photos and profiles are kept. AiVastra holds them only for you.
      </div>
      <ListState
        status={settings.status}
        isEmpty={false}
        emptyText=""
        error="Could not load customer data settings."
        onRetry={() => void settings.refetch()}
      >
        {s && (
          <CustomerDataForm
            key={`${s.photoRetentionDays}-${s.profileRetentionDays}-${s.identifyAt}`}
            settings={s}
            onSaved={(next) => {
              qc.setQueryData(CRM_KEY, next);
              toast.show('Customer data settings saved', 'success');
            }}
            onError={(m) => toast.show(m)}
          />
        )}
      </ListState>
    </section>
  );
}

function CustomerDataForm({
  settings,
  onSaved,
  onError,
}: {
  settings: CrmSettingsResponse;
  onSaved: (s: CrmSettingsResponse) => void;
  onError: (message: string) => void;
}) {
  const [photo, setPhoto] = useState(settings.photoRetentionDays?.toString() ?? '');
  const [profile, setProfile] = useState(settings.profileRetentionDays?.toString() ?? '');
  const [identifyAt, setIdentifyAt] = useState<'end' | 'start'>(settings.identifyAt);
  const [errors, setErrors] = useState<{ photo?: string; profile?: string }>({});
  const save = useMutation({
    mutationFn: (body: CrmSettingsPutBody) =>
      apiFetch<CrmSettingsResponse>('/v1/merchant/crm-settings', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: onSaved,
    onError: (e: unknown) =>
      onError(e instanceof Error ? e.message : 'The request could not be completed.'),
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseRetention(photo, 'photo');
    const q = parseRetention(profile, 'profile');
    const errs = {
      photo: typeof p === 'string' ? p : undefined,
      profile: typeof q === 'string' ? q : undefined,
    };
    setErrors(errs);
    if (typeof p === 'number' && typeof q === 'number') {
      save.mutate({ identifyAt, photoRetentionDays: p, profileRetentionDays: q });
    }
  };
  const id = settings.identification;
  return (
    <form onSubmit={submit} style={{ marginTop: 12, display: 'grid', gap: 12 }}>
      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        }}
      >
        <Field id="crm-photo" label="Keep shopper photos for (days)" error={errors.photo}>
          <input
            id="crm-photo"
            inputMode="numeric"
            value={photo}
            onChange={(e) => {
              setPhoto(e.target.value);
              setErrors({ ...errors, photo: undefined });
            }}
            aria-invalid={errors.photo ? true : undefined}
            aria-describedby={errors.photo ? 'crm-photo-err' : undefined}
            style={field(!!errors.photo)}
          />
        </Field>
        <Field id="crm-profile" label="Keep customer profiles for (days)" error={errors.profile}>
          <input
            id="crm-profile"
            inputMode="numeric"
            value={profile}
            onChange={(e) => {
              setProfile(e.target.value);
              setErrors({ ...errors, profile: undefined });
            }}
            aria-invalid={errors.profile ? true : undefined}
            aria-describedby={errors.profile ? 'crm-profile-err' : undefined}
            style={field(!!errors.profile)}
          />
        </Field>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 13, color: C.mid }}>Ask for WhatsApp</span>
          <PremiumSelect
            ariaLabel="When to ask for WhatsApp"
            value={identifyAt}
            onChange={(v) => setIdentifyAt(v === 'start' ? 'start' : 'end')}
            options={[
              { value: 'end', label: 'At the end of the visit' },
              { value: 'start', label: 'Before the first try-on' },
            ]}
            fullWidth
            height={40}
          />
        </div>
      </div>
      <div style={help}>Profiles are counted from the customer's last visit.</div>
      <div
        role="status"
        style={{
          fontSize: 13,
          color: id.enabled ? C.text : C.mid,
          fontWeight: 600,
        }}
      >
        {id.enabled
          ? 'WhatsApp identification is on.'
          : `Before shoppers can get looks on WhatsApp: ${id.blockers.map(blockerText).join(' ')}`}
      </div>
      <div>
        <button type="submit" disabled={save.isPending} style={btn(true)}>
          {save.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  );
}

export function CustomerDataSettings() {
  return (
    <>
      <WhatsappChannelCard />
      <CustomerDataCard />
    </>
  );
}
