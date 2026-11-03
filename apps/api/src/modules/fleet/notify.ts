import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { sendFleetAlertEmail } from '../../lib/mailer.js';

// Emails operators when a fleet incident opens, escalates or recovers. Strictly opt-in
// (FLEET_ALERT_EMAILS) and never allowed to break the evaluator: a mail outage must not stop
// incidents from being recorded, so every failure is logged and swallowed here.

export type FleetNotice = {
  kind: 'opened' | 'escalated' | 'recovered';
  // Rows carry severity as plain text; anything but critical/warning is dashboard-only.
  severity: string;
  workerId: string;
  ruleKey: string;
  summary: string;
};

export const ALERT_EMAILS_SETTING = 'alertEmails';

export type AlertRecipients = {
  emails: string[];
  source: 'dashboard' | 'env' | 'none';
  updatedAt: Date | null;
};

export type NotifyDeps = {
  send?: SendFleetEmail;
  loadRecipients?: (app: FastifyInstance) => Promise<AlertRecipients>;
};

export type SendFleetEmail = (args: {
  to: string[];
  notice: FleetNotice;
  dashboardUrl?: string;
}) => Promise<void>;

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/** Comma-separated list to the valid addresses; anything malformed is dropped, not guessed at. */
export function parseAlertRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(',')
        .map((x) => x.trim())
        .filter((x) => EMAIL.test(x)),
    ),
  ];
}

/**
 * A list saved in the dashboard wins, including an empty one (off on purpose). With nothing saved
 * the server environment's FLEET_ALERT_EMAILS applies, and with neither nothing is ever sent.
 */
export async function loadAlertRecipients(app: FastifyInstance): Promise<AlertRecipients> {
  const [row] = await app.db
    .select()
    .from(schema.fleetSettings)
    .where(eq(schema.fleetSettings.key, ALERT_EMAILS_SETTING));
  if (row) {
    const saved = Array.isArray(row.value)
      ? row.value.filter((x): x is string => typeof x === 'string')
      : [];
    return {
      emails: parseAlertRecipients(saved.join(',')),
      source: 'dashboard',
      updatedAt: row.updatedAt,
    };
  }
  const fromEnv = parseAlertRecipients(app.env.FLEET_ALERT_EMAILS);
  return { emails: fromEnv, source: fromEnv.length ? 'env' : 'none', updatedAt: null };
}

export async function notifyFleetIncident(
  app: FastifyInstance,
  notice: FleetNotice,
  deps: NotifyDeps = {},
): Promise<'sent' | 'skipped' | 'failed'> {
  const { send, loadRecipients = loadAlertRecipients } = deps;
  let to: string[];
  try {
    to = (await loadRecipients(app)).emails;
  } catch (err) {
    app.log.warn({ err }, 'fleet alert recipients could not be read');
    return 'failed';
  }
  // Info incidents (swap, skew, foreign VRAM) are dashboard-only: they would drown the real ones.
  const severity =
    notice.severity === 'critical' || notice.severity === 'warning' ? notice.severity : null;
  if (to.length === 0 || severity === null) return 'skipped';
  const dashboardUrl = app.env.FLEET_DASHBOARD_URL;
  try {
    if (send) await send({ to, notice, dashboardUrl });
    else
      await sendFleetAlertEmail(app.env.RESEND_API_KEY, app.env.EMAIL_FROM, to, {
        ...notice,
        severity,
        dashboardUrl,
      });
    return 'sent';
  } catch (err) {
    app.log.warn(
      { err, workerId: notice.workerId, ruleKey: notice.ruleKey },
      'fleet alert email failed',
    );
    return 'failed';
  }
}
