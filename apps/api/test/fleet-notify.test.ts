import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  type AlertRecipients,
  type FleetNotice,
  notifyFleetIncident,
  parseAlertRecipients,
} from '../src/modules/fleet/notify';

// The real loader reads the database; these tests exercise the filtering around it.
const fromEnv = async (app: FastifyInstance): Promise<AlertRecipients> => ({
  emails: parseAlertRecipients(app.env.FLEET_ALERT_EMAILS),
  source: 'env',
  updatedAt: null,
});

const notice = (over: Partial<FleetNotice> = {}): FleetNotice => ({
  kind: 'opened',
  severity: 'warning',
  workerId: 'worker-3',
  ruleKey: 'disk_high',
  summary: 'Disk / is 96% full.',
  ...over,
});

function fakeApp(env: Record<string, string | undefined>) {
  const warn = vi.fn();
  return {
    app: {
      env: { RESEND_API_KEY: 'x', EMAIL_FROM: 'a@b.co', ...env },
      log: { warn },
    } as never as FastifyInstance,
    warn,
  };
}

describe('parseAlertRecipients', () => {
  it('keeps valid addresses, trims, de-duplicates and drops malformed ones', () => {
    expect(
      parseAlertRecipients(' ops@example.com, bad, ops@example.com ,x@y , lead@example.org'),
    ).toEqual(['ops@example.com', 'lead@example.org']);
  });
  it('is empty when unset or blank', () => {
    expect(parseAlertRecipients(undefined)).toEqual([]);
    expect(parseAlertRecipients('  ')).toEqual([]);
  });
});

describe('notifyFleetIncident', () => {
  it('sends nothing when no recipients are configured', async () => {
    const { app } = fakeApp({});
    const send = vi.fn();
    expect(await notifyFleetIncident(app, notice(), { send, loadRecipients: fromEnv })).toBe(
      'skipped',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('sends warning and critical incidents to every recipient', async () => {
    const { app } = fakeApp({
      FLEET_ALERT_EMAILS: 'a@example.com,b@example.com',
      FLEET_DASHBOARD_URL: 'https://ops.example.com',
    });
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await notifyFleetIncident(app, notice(), { send, loadRecipients: fromEnv })).toBe(
      'sent',
    );
    expect(
      await notifyFleetIncident(app, notice({ severity: 'critical' }), {
        send,
        loadRecipients: fromEnv,
      }),
    ).toBe('sent');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      to: ['a@example.com', 'b@example.com'],
      dashboardUrl: 'https://ops.example.com',
      notice: { workerId: 'worker-3', ruleKey: 'disk_high' },
    });
  });

  it('keeps info incidents (and unknown severities) dashboard-only', async () => {
    const { app } = fakeApp({ FLEET_ALERT_EMAILS: 'a@example.com' });
    const send = vi.fn();
    expect(
      await notifyFleetIncident(app, notice({ severity: 'info' }), {
        send,
        loadRecipients: fromEnv,
      }),
    ).toBe('skipped');
    expect(
      await notifyFleetIncident(app, notice({ severity: 'weird' }), {
        send,
        loadRecipients: fromEnv,
      }),
    ).toBe('skipped');
    expect(send).not.toHaveBeenCalled();
  });

  it('reports failed, without throwing, when the recipient list cannot be read', async () => {
    const { app, warn } = fakeApp({});
    const send = vi.fn();
    const loadRecipients = vi.fn().mockRejectedValue(new Error('db down'));
    await expect(notifyFleetIncident(app, notice(), { send, loadRecipients })).resolves.toBe(
      'failed',
    );
    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('logs and swallows a mail failure instead of throwing into the evaluator', async () => {
    const { app, warn } = fakeApp({ FLEET_ALERT_EMAILS: 'a@example.com' });
    const send = vi.fn().mockRejectedValue(new Error('resend down'));
    await expect(
      notifyFleetIncident(app, notice(), { send, loadRecipients: fromEnv }),
    ).resolves.toBe('failed');
    expect(warn).toHaveBeenCalledOnce();
  });
});
