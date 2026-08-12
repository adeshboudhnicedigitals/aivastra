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

function receiptHtml(r: {
  planName: string;
  credits: number;
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  paidAt: Date;
}): string {
  const fmt = (paise: number) =>
    `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const fmtDate = (d: Date) =>
    d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  return `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f6f6f6;margin:0;padding:40px 0;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
    <div style="background:#1a1a1a;padding:28px 32px;text-align:center;">
      <h1 style="color:#fff;font-size:20px;font-weight:700;margin:0;">Aivastra</h1>
      <p style="color:rgba(255,255,255,0.6);font-size:13px;margin:6px 0 0;">Payment Receipt</p>
    </div>
    <div style="padding:32px;">
      <p style="font-size:14px;color:#555;margin:0 0 24px;">Thank you for your purchase! Your credits have been added to your account.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
        <tr style="background:#f9f9f9;">
          <th style="text-align:left;padding:10px 12px;color:#666;font-weight:600;border-bottom:1px solid #eee;">Description</th>
          <th style="text-align:right;padding:10px 12px;color:#666;font-weight:600;border-bottom:1px solid #eee;">Amount</th>
        </tr>
        <tr>
          <td style="padding:12px;color:#1a1a1a;">${r.planName} — ${r.credits.toLocaleString('en-IN')} Credits</td>
          <td style="padding:12px;color:#1a1a1a;text-align:right;">${fmt(r.basePaise)}</td>
        </tr>
        <tr style="background:#fafafa;">
          <td style="padding:10px 12px;color:#666;font-size:13px;">GST (18%)</td>
          <td style="padding:10px 12px;color:#666;font-size:13px;text-align:right;">${fmt(r.gstPaise)}</td>
        </tr>
        <tr style="border-top:2px solid #1a1a1a;">
          <td style="padding:12px;color:#1a1a1a;font-weight:700;">Total Paid</td>
          <td style="padding:12px;color:#1a1a1a;font-weight:700;text-align:right;">${fmt(r.totalPaise)}</td>
        </tr>
      </table>
      <div style="background:#f9f9f9;border-radius:8px;padding:16px;font-size:13px;color:#555;line-height:1.8;">
        <div><span style="color:#999;">Date:</span> <strong style="color:#1a1a1a;">${fmtDate(r.paidAt)}</strong></div>
        <div><span style="color:#999;">Order ID:</span> <strong style="color:#1a1a1a;">${r.razorpayOrderId}</strong></div>
        <div><span style="color:#999;">Payment ID:</span> <strong style="color:#1a1a1a;">${r.razorpayPaymentId}</strong></div>
      </div>
      <p style="font-size:12px;color:#999;margin:24px 0 0;text-align:center;">If you have any questions, reply to this email or contact support.</p>
    </div>
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

export async function sendPaymentReceiptEmail(
  apiKey: string,
  from: string,
  to: string,
  receipt: {
    planName: string;
    credits: number;
    basePaise: number;
    gstPaise: number;
    totalPaise: number;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    paidAt: Date;
  },
  attachments?: Array<{ filename: string; content: Buffer }>,
): Promise<void> {
  const totalRupees = (receipt.totalPaise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
  });
  await send(apiKey, {
    from,
    to,
    subject: `Payment confirmed — ${receipt.credits.toLocaleString('en-IN')} credits (₹${totalRupees})`,
    html: receiptHtml(receipt),
    attachments,
  });
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
