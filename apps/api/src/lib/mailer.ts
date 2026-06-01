import { Resend } from 'resend';

let _client: Resend | null = null;
function getClient(apiKey: string): Resend {
  if (!_client) _client = new Resend(apiKey);
  return _client;
}

function verifyHtml(link: string): string {
  return `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f6f6f6;margin:0;padding:40px 0;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;text-align:center;">
    <h1 style="font-size:22px;font-weight:700;color:#1a1a1a;margin-bottom:8px;">Verify your email</h1>
    <p style="font-size:14px;color:#555;margin-bottom:32px;">Click the button below to verify your Aivastra account. This link expires in 24 hours.</p>
    <a href="${link}" style="display:inline-block;background:#1a1a1a;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">Verify Email</a>
    <p style="font-size:12px;color:#999;margin-top:32px;">If you didn't create an account, you can safely ignore this email.</p>
  </div>
</body>
</html>`;
}

function resetHtml(link: string): string {
  return `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f6f6f6;margin:0;padding:40px 0;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;text-align:center;">
    <h1 style="font-size:22px;font-weight:700;color:#1a1a1a;margin-bottom:8px;">Reset your password</h1>
    <p style="font-size:14px;color:#555;margin-bottom:32px;">Click the button below to reset your Aivastra password. This link expires in 1 hour.</p>
    <a href="${link}" style="display:inline-block;background:#1a1a1a;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">Reset Password</a>
    <p style="font-size:12px;color:#999;margin-top:32px;">If you didn't request a password reset, you can safely ignore this email.</p>
  </div>
</body>
</html>`;
}

async function send(
  apiKey: string,
  payload: Parameters<Resend['emails']['send']>[0],
): Promise<void> {
  const { error } = await getClient(apiKey).emails.send(payload);
  if (error) throw new Error(`Resend error: ${error.name} — ${error.message}`);
}

export async function sendVerificationEmail(
  apiKey: string,
  from: string,
  webUrl: string,
  to: string,
  token: string,
): Promise<void> {
  const link = `${webUrl}/verify-email/confirm?token=${token}`;
  await send(apiKey, { from, to, subject: 'Verify your Aivastra account', html: verifyHtml(link) });
}

export async function sendPasswordResetEmail(
  apiKey: string,
  from: string,
  webUrl: string,
  to: string,
  token: string,
): Promise<void> {
  const link = `${webUrl}/reset-password?token=${token}`;
  await send(apiKey, { from, to, subject: 'Reset your Aivastra password', html: resetHtml(link) });
}
