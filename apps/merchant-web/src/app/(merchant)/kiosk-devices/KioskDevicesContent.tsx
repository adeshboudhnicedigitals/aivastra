'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import type { MerchantData } from '../../lib';

type Device = {
  id: string;
  label: string;
  status: string;
  androidId: string | null;
  appVersion: string | null;
  lastSeenAt: string | null;
  pairedAt: string | null;
  pairingCodeExpiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function KioskDevicesContent({ data }: { data: MerchantData }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [workingId, setWorkingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/merchant/kiosk-devices', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load kiosk devices.');
      const body = (await res.json()) as { devices?: Device[] };
      setDevices(body.devices ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load kiosk devices.');
    } finally {
      setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load only closes over stable setState setters; run once on mount
  useEffect(() => {
    void load();
  }, []);

  const activeCount = useMemo(
    () => devices.filter((device) => device.status !== 'revoked').length,
    [devices],
  );

  async function createDevice() {
    if (!label.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/merchant/kiosk-devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        device?: Device;
        pairingCode?: string;
        error?: { message?: string };
      };
      if (!res.ok || !body.device || !body.pairingCode) {
        throw new Error(body.error?.message ?? 'Failed to create kiosk device.');
      }
      setDevices((current) => [body.device as Device, ...current]);
      setPairingCode(body.pairingCode);
      setLabel('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create kiosk device.');
    } finally {
      setSubmitting(false);
    }
  }

  async function regenerate(deviceId: string) {
    setWorkingId(deviceId);
    setError('');
    try {
      const res = await fetch(`/api/merchant/kiosk-devices/${deviceId}/pairing-code`, {
        method: 'POST',
      });
      const body = (await res.json().catch(() => ({}))) as {
        device?: Device;
        pairingCode?: string;
        error?: { message?: string };
      };
      if (!res.ok || !body.device || !body.pairingCode) {
        throw new Error(body.error?.message ?? 'Failed to generate pairing code.');
      }
      setDevices((current) =>
        current.map((device) => (device.id === deviceId ? (body.device as Device) : device)),
      );
      setPairingCode(body.pairingCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate pairing code.');
    } finally {
      setWorkingId(null);
    }
  }

  const [revokeTarget, setRevokeTarget] = useState<Device | null>(null);

  async function revoke(device: Device) {
    setRevokeTarget(device);
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    const deviceId = revokeTarget.id;
    setWorkingId(deviceId);
    setError('');
    try {
      const res = await fetch(`/api/merchant/kiosk-devices/${deviceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'revoked' }),
      });
      const body = (await res.json().catch(() => ({}))) as
        | Device
        | { error?: { message?: string } };
      if (!res.ok) {
        throw new Error(
          (body as { error?: { message?: string } }).error?.message ?? 'Failed to revoke device.',
        );
      }
      setDevices((current) =>
        current.map((device) => (device.id === deviceId ? (body as Device) : device)),
      );
      setRevokeTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke device.');
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
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
          Kiosk Devices
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'hsl(var(--text-secondary))', margin: 0 }}>
          Pair, monitor, and revoke in-store tablets that run your kiosk experience.
        </p>
      </div>

      {pairingCode && (
        <Card
          style={{
            borderColor: 'hsl(var(--success-base))',
            background: 'hsl(var(--success-subtle))',
          }}
        >
          <CardContent style={{ padding: 'var(--space-4)' }}>
            <div
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                color: 'hsl(var(--success-base))',
                marginBottom: 'var(--space-2)',
              }}
            >
              Pairing Code
            </div>
            <div
              style={{
                fontSize: '2rem',
                fontWeight: 700,
                color: 'hsl(var(--success-base))',
                letterSpacing: '0.08em',
                marginBottom: 'var(--space-1)',
              }}
            >
              {pairingCode}
            </div>
            <div style={{ fontSize: '0.875rem', color: 'hsl(var(--success-base))' }}>
              This is shown only once. Enter it on the Android kiosk during device claim.
            </div>
          </CardContent>
        </Card>
      )}

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

      <div className="grid-responsive-2" style={{ alignItems: 'start' }}>
        <Card>
          <CardHeader>
            <CardTitle>Registered Devices</CardTitle>
            <CardDescription>
              {activeCount} in use of {data.maxKioskDevices} allowed devices
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div style={{ fontSize: '0.875rem', color: 'hsl(var(--text-tertiary))' }}>
                Loading kiosk devices...
              </div>
            ) : devices.length === 0 ? (
              <div style={{ fontSize: '0.875rem', color: 'hsl(var(--text-tertiary))' }}>
                No kiosk devices have been created yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {devices.map((device) => {
                  const isActive = device.status === 'active';
                  const isRevoked = device.status === 'revoked';
                  const badgeVariant = isRevoked ? 'danger' : isActive ? 'success' : 'primary';

                  return (
                    <div
                      key={device.id}
                      style={{
                        padding: 'var(--space-4)',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid hsl(var(--border-default))',
                        background: 'hsl(var(--bg-surface-hover))',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          marginBottom: 'var(--space-4)',
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: '1rem',
                              fontWeight: 600,
                              color: 'hsl(var(--text-primary))',
                            }}
                          >
                            {device.label}
                          </div>
                          <div
                            style={{
                              fontSize: '0.75rem',
                              color: 'hsl(var(--text-tertiary))',
                              marginTop: 2,
                            }}
                          >
                            Created {new Date(device.createdAt).toLocaleString()}
                          </div>
                        </div>
                        <Badge variant={badgeVariant}>{device.status}</Badge>
                      </div>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                          gap: 'var(--space-3)',
                          marginBottom: 'var(--space-4)',
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              color: 'hsl(var(--text-tertiary))',
                              textTransform: 'uppercase',
                            }}
                          >
                            App version
                          </div>
                          <div
                            style={{ fontSize: '0.8125rem', color: 'hsl(var(--text-secondary))' }}
                          >
                            {device.appVersion ?? 'Unknown'}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              color: 'hsl(var(--text-tertiary))',
                              textTransform: 'uppercase',
                            }}
                          >
                            Android ID
                          </div>
                          <div
                            style={{ fontSize: '0.8125rem', color: 'hsl(var(--text-secondary))' }}
                          >
                            {device.androidId ?? 'Not paired yet'}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              color: 'hsl(var(--text-tertiary))',
                              textTransform: 'uppercase',
                            }}
                          >
                            Paired at
                          </div>
                          <div
                            style={{ fontSize: '0.8125rem', color: 'hsl(var(--text-secondary))' }}
                          >
                            {device.pairedAt
                              ? new Date(device.pairedAt).toLocaleString()
                              : 'Not paired yet'}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              color: 'hsl(var(--text-tertiary))',
                              textTransform: 'uppercase',
                            }}
                          >
                            Pairing expires
                          </div>
                          <div
                            style={{ fontSize: '0.8125rem', color: 'hsl(var(--text-secondary))' }}
                          >
                            {device.pairingCodeExpiresAt
                              ? new Date(device.pairingCodeExpiresAt).toLocaleString()
                              : 'No pending code'}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={isActive || workingId === device.id}
                          onClick={() => void regenerate(device.id)}
                        >
                          {workingId === device.id ? 'Working...' : 'Generate pairing code'}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={isRevoked || workingId === device.id}
                          onClick={() => void revoke(device)}
                        >
                          Revoke
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create Kiosk Device</CardTitle>
            <CardDescription>
              Device creation is only available when kiosk access is enabled for this merchant
              account.
            </CardDescription>
          </CardHeader>
          <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div
              style={{
                padding: 'var(--space-3) var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: 'hsl(var(--bg-surface-hover))',
                border: '1px solid hsl(var(--border-default))',
              }}
            >
              <div
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'hsl(var(--text-tertiary))',
                  textTransform: 'uppercase',
                }}
              >
                Kiosk Access
              </div>
              <div
                style={{
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: 'hsl(var(--text-primary))',
                  marginTop: 2,
                }}
              >
                {data.kioskEnabled ? 'Enabled' : 'Disabled'}
              </div>
              <div
                style={{ fontSize: '0.8125rem', color: 'hsl(var(--text-secondary))', marginTop: 4 }}
              >
                Device cap: {data.maxKioskDevices}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <label
                htmlFor="device-label"
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'hsl(var(--text-secondary))',
                  textTransform: 'uppercase',
                }}
              >
                Device Label
              </label>
              <Input
                id="device-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Front counter tablet"
              />
            </div>

            <Button
              variant="primary"
              disabled={
                submitting ||
                !data.kioskEnabled ||
                activeCount >= data.maxKioskDevices ||
                !label.trim()
              }
              onClick={() => void createDevice()}
            >
              {submitting ? 'Creating...' : 'Create kiosk device'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Modal
        isOpen={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        title="Revoke Kiosk Device"
        description="Are you sure you want to revoke access for this kiosk device? It will immediately lose authorization to connect."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmRevoke()}
              disabled={workingId === revokeTarget?.id}
            >
              {workingId === revokeTarget?.id ? 'Revoking...' : 'Revoke Device'}
            </Button>
          </>
        }
      >
        {revokeTarget && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ fontWeight: 600, color: 'hsl(var(--text-primary))' }}>
              {revokeTarget.label}
            </div>
            {revokeTarget.androidId && (
              <div style={{ fontSize: '0.8125rem', color: 'hsl(var(--text-secondary))' }}>
                Android ID: {revokeTarget.androidId}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
