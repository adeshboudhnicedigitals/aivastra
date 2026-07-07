'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { MerchantData } from '../../lib';

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

  const field = (id: string, lbl: string, children: React.ReactNode) => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        marginBottom: 'var(--space-4)',
      }}
    >
      <label
        htmlFor={id}
        style={{ fontSize: '0.875rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}
      >
        {lbl}
      </label>
      {children}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 800 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 'var(--space-4)',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 600,
              color: 'hsl(var(--text-primary))',
              letterSpacing: '-0.02em',
              margin: '0 0 var(--space-2)',
            }}
          >
            Update Profile
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'hsl(var(--text-secondary))', margin: 0 }}>
            Manage your personal and company information.
          </p>
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Changes'}
        </Button>
      </div>

      {error && (
        <div
          style={{
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            background: 'hsl(var(--danger-subtle))',
            color: 'hsl(var(--danger-base))',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          {error}
        </div>
      )}

      {/* Avatar */}
      <Card>
        <CardContent style={{ paddingTop: 'var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                background:
                  'linear-gradient(135deg, hsl(var(--accent-primary)), hsl(var(--accent-primary) / 0.7))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '2rem',
                fontWeight: 600,
                color: 'hsl(var(--text-inverse))',
                flexShrink: 0,
                boxShadow: '0 4px 14px hsl(var(--accent-primary) / 0.3)',
              }}
            >
              {contactName.charAt(0).toUpperCase()}
            </div>
            <div>
              <p
                style={{
                  fontSize: '1.125rem',
                  fontWeight: 600,
                  color: 'hsl(var(--text-primary))',
                  margin: '0 0 var(--space-1)',
                }}
              >
                {contactName}
              </p>
              <p
                style={{
                  fontSize: '0.875rem',
                  color: 'hsl(var(--text-tertiary))',
                  margin: '0 0 var(--space-3)',
                }}
              >
                {data.email}
              </p>
              <Button variant="outline" size="sm">
                Change Photo
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Personal Info */}
      <Card>
        <CardHeader>
          <CardTitle>Personal Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid-responsive-equal-2">
            {field(
              'full-name',
              'Full Name',
              <Input
                id="full-name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
              />,
            )}
            {field(
              'email-addr',
              'Email Address',
              <Input
                id="email-addr"
                value={data.email}
                readOnly
                disabled
                title="Email cannot be changed"
              />,
            )}
            {field(
              'phone-num',
              'Phone Number',
              <Input id="phone-num" value={phone} onChange={(e) => setPhone(e.target.value)} />,
            )}
          </div>
        </CardContent>
      </Card>

      {/* Company Info */}
      <Card>
        <CardHeader>
          <CardTitle>Company Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid-responsive-equal-2">
            {field(
              'company-name',
              'Company Name',
              <Input
                id="company-name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />,
            )}
            {field(
              'website-url',
              'Website URL',
              <Input
                id="website-url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
              />,
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
