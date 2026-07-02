'use client';
import { useState } from 'react';
import type { MerchantData } from '../../lib';

const card: React.CSSProperties = {
  background: 'var(--c-white)',
  borderRadius: 14,
  border: '1px solid var(--c-merchant-border)',
  padding: '28px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  marginBottom: 20,
};

const fieldLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--c-merchant-text-secondary)',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid var(--c-merchant-input-border)',
  fontSize: 13,
  color: 'var(--c-merchant-text-secondary)',
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
  background: 'var(--c-white)',
};

export function ProfileContent({ data }: { data: MerchantData }) {
  const [contactName, setContactName] = useState(data.contactName);
  const [phone, setPhone] = useState(data.phone);
  const [companyName, setCompanyName] = useState(data.companyName);
  const [websiteUrl, setWebsiteUrl] = useState(data.websiteUrl);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/merchant/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactName: contactName.trim(),
          phone: phone.trim(),
          companyName: companyName.trim(),
          websiteUrl: websiteUrl.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err?.error?.message ?? 'Could not save changes. Please try again.');
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const field = (lbl: string, children: React.ReactNode) => (
    <div style={{ marginBottom: 18 }}>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: visual label only, input is passed as children */}
      <label style={fieldLabel}>{lbl}</label>
      {children}
    </div>
  );

  return (
    <>
      <div
        style={{
          marginBottom: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-text)', margin: '0 0 4px' }}>
            Update Profile
          </h1>
          <p style={{ fontSize: 14, color: 'var(--c-merchant-text-placeholder)', margin: 0 }}>
            Manage your personal and company information.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{
            padding: '10px 24px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--c-merchant-accent)',
            color: 'var(--c-white)',
            fontSize: 13,
            fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1,
            fontFamily: 'inherit',
          }}
        >
          {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Changes'}
        </button>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 20,
            padding: '12px 16px',
            borderRadius: 8,
            background: 'var(--c-merchant-danger-tint)',
            color: 'var(--c-merchant-danger)',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {error}
        </div>
      )}

      {/* Avatar */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: '50%',
              background: 'linear-gradient(135deg,#7c5cfc,#c44dfa)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 26,
              fontWeight: 700,
              color: 'var(--c-white)',
              flexShrink: 0,
              boxShadow: '0 4px 14px rgba(124,92,252,0.3)',
            }}
          >
            {contactName.charAt(0).toUpperCase()}
          </div>
          <div>
            <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--c-text)', margin: '0 0 3px' }}>
              {contactName}
            </p>
            <p
              style={{
                fontSize: 13,
                color: 'var(--c-merchant-text-placeholder)',
                margin: '0 0 12px',
              }}
            >
              {data.email}
            </p>
            <button
              type="button"
              style={{
                padding: '6px 14px',
                borderRadius: 7,
                border: '1px solid var(--c-merchant-input-border)',
                background: 'var(--c-white)',
                color: 'var(--c-merchant-text-secondary)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Change Photo
            </button>
          </div>
        </div>
      </div>

      {/* Personal Info */}
      <div style={card}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)', margin: '0 0 20px' }}>
          Personal Information
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
          {field(
            'Full Name',
            <input
              style={inputStyle}
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />,
          )}
          {field(
            'Email Address',
            <input
              style={{
                ...inputStyle,
                background: 'var(--c-merchant-code-bg)',
                color: 'var(--c-merchant-text-placeholder)',
                cursor: 'not-allowed',
              }}
              value={data.email}
              readOnly
              title="Email cannot be changed"
            />,
          )}
          {field(
            'Phone Number',
            <input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} />,
          )}
        </div>
      </div>

      {/* Company Info */}
      <div style={card}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)', margin: '0 0 20px' }}>
          Company Information
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
          {field(
            'Company Name',
            <input
              style={inputStyle}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />,
          )}
          {field(
            'Website URL',
            <input
              style={inputStyle}
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
            />,
          )}
        </div>
      </div>
    </>
  );
}
