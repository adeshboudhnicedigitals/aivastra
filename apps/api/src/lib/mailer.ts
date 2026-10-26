import { Resend } from 'resend';

let _client: Resend | null = null;
function getClient(apiKey: string): Resend {
  if (!_client) _client = new Resend(apiKey);
  return _client;
}

// Brand chrome shared by every template below. The logo image is hosted by
// catalogues-web (app.aivastra.com) — the only place the gradient app-icon
// asset actually lives; the footer "website" link points at the separate
// marketing site (aivastra.com, confirmed live: /terms, /privacy-policy).
// Transparent-background variant (not the opaque PWA icon) so it sits
// cleanly on the card/footer background instead of showing a dark square.
const LOGO_URL = 'https://app.aivastra.com/tryon-library-app-icon-512-transparent.png';
const BRAND_URL = 'https://aivastra.com';
const WHATSAPP_DISPLAY = '+91 77298 83692';
const WHATSAPP_LINK = 'https://wa.me/917729883692';
const ACCENT = '#6C4CF1';
const ACCENT_2 = '#C026D3';
const BANNER_BG = '#17123A';

// Lightens (positive percent) or darkens (negative) a hex color — used to turn
// each banner's flat status color into a same-hue gradient without having to
// hand-pick a second stop for every accent (amber/red/navy/purple) it's called with.
function shade(hex: string, percent: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const amt = Math.round(2.55 * percent);
  const clamp = (v: number) => Math.max(0, Math.min(255, v + amt));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function logoRow(size: number, textSize: number): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="padding-right:8px;"><img src="${LOGO_URL}" width="${size}" height="${size}" alt="Ai Vastra" style="display:block;border-radius:${Math.round(size * 0.22)}px;" /></td>
    <td style="font-size:${textSize}px;font-weight:700;color:#1a1a1a;letter-spacing:.2px;vertical-align:middle;">Ai Vastra</td>
  </tr></table>`;
}

function banner(heading: string, bg: string = BANNER_BG): string {
  // A trailing emoji wraps onto its own line at narrow widths unless it's
  // glued to the last word with a non-breaking space.
  const safeHeading = heading.replace(/ (\p{Emoji_Presentation}+)$/u, '&nbsp;$1');
  // background-color is the fallback for clients that ignore gradients (e.g. Outlook desktop);
  // background (gradient) is a progressive enhancement layered on top for everyone else.
  return `<div style="background-color:${bg};background:linear-gradient(135deg,${shade(bg, 16)},${bg});border-radius:16px;padding:32px 24px;text-align:center;margin:0 0 28px;box-shadow:0 6px 16px rgba(0,0,0,0.14);">
    <h1 style="margin:0;color:#fff;font-size:23px;line-height:1.35;font-weight:700;letter-spacing:.2px;">${safeHeading}</h1>
  </div>`;
}

function button(url: string, label: string): string {
  return `<div style="text-align:center;margin:30px 0 8px;">
    <a href="${url}" style="display:inline-block;background-color:${ACCENT};background:linear-gradient(135deg,${ACCENT},${ACCENT_2});color:#fff;font-size:14px;font-weight:700;letter-spacing:.2px;padding:15px 34px;border-radius:999px;text-decoration:none;box-shadow:0 8px 18px rgba(108,76,241,0.32);">${label}</a>
  </div>`;
}

function signOff(): string {
  return `<p style="font-size:14px;color:#555;margin:0 0 6px;">Best regards,</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="padding-right:6px;"><img src="${LOGO_URL}" width="16" height="16" alt="" style="display:block;border-radius:4px;" /></td>
    <td style="font-size:14px;font-weight:700;color:#1a1a1a;vertical-align:middle;">Team AI Vastra</td>
  </tr></table>`;
}

function emailShell(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background-color:#EEECF9;background:linear-gradient(180deg,#F5F3FD,#EEECF9);margin:0;padding:40px 16px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #ECE9F7;box-shadow:0 10px 30px rgba(31,16,94,0.08);">
      <div style="height:6px;line-height:6px;font-size:0;background-color:${ACCENT};background:linear-gradient(90deg,${ACCENT},${ACCENT_2});">&nbsp;</div>
      <div style="padding:40px 40px 36px;">
        <div style="padding-bottom:20px;border-bottom:1px solid #F0EEFA;margin-bottom:28px;">
          ${logoRow(28, 18)}
        </div>
        ${bodyHtml}
      </div>
    </div>
    <div style="text-align:center;padding:32px 16px 0;">
      <p style="font-size:12px;color:#8a8a9a;margin:0 0 14px;letter-spacing:.2px;">AI-Powered Fashion Photography &amp; Virtual Try-On</p>
      <p style="font-size:12px;margin:0 0 6px;">🌐 <a href="${BRAND_URL}" style="color:${ACCENT};font-weight:600;text-decoration:none;">${BRAND_URL}</a></p>
      <p style="font-size:12px;margin:0 0 20px;">💬 WhatsApp: <a href="${WHATSAPP_LINK}" style="color:${ACCENT};font-weight:600;text-decoration:none;">${WHATSAPP_DISPLAY}</a></p>
      <div style="display:inline-block;opacity:0.85;">${logoRow(20, 13)}</div>
    </div>
  </div>
</body>
</html>`;
}

function verifyHtml(link: string, name?: string | null): string {
  const content = `
    ${banner('Verify your email')}
    <p style="font-size:14px;color:#555;margin:0 0 16px;">${greeting(name)}</p>
    <p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 8px;text-align:center;">Click the button below to verify your Aivastra account. This link expires in 24 hours.</p>
    ${button(link, 'Verify Email')}
    <p style="font-size:12px;color:#999;margin:24px 0 0;text-align:center;">If you didn't create an account, you can safely ignore this email.</p>
  `;
  return emailShell(content);
}

function welcomeHtml(name?: string | null): string {
  const content = `
    ${banner('Thank You for Signing Up with AI Vastra 🎉')}
    <p style="font-size:14px;color:#555;margin:0 0 16px;">${greeting(name)}</p>
    <p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 20px;">Thank you for signing up with AI Vastra! We're excited to help you transform your fashion business with our AI-powered solutions:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;">
      <tr>
        <td width="48%" valign="top" style="background:#F8F7FD;border:1px solid #ECE9F7;border-radius:14px;padding:20px 18px;">
          <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#1a1a1a;">🪄&nbsp; AI Virtual Try-On</p>
          <p style="margin:0;font-size:13px;color:#666;line-height:1.5;">Let customers virtually try your products before buying.</p>
        </td>
        <td width="4%">&nbsp;</td>
        <td width="48%" valign="top" style="background:#F8F7FD;border:1px solid #ECE9F7;border-radius:14px;padding:20px 18px;">
          <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#1a1a1a;">📸&nbsp; AI Catalogue Photoshoot</p>
          <p style="margin:0;font-size:13px;color:#666;line-height:1.5;">Create professional fashion catalogue images without traditional photoshoots.</p>
        </td>
      </tr>
    </table>
    <p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 24px;">We look forward to helping you save time, reduce photoshoot costs, and create a better shopping experience for your customers.</p>
    <p style="font-size:14px;color:#555;margin:0 0 4px;">For any support, please contact us:</p>
    <p style="font-size:14px;color:#555;margin:0 0 4px;">📧 <a href="mailto:support@aivastra.com" style="color:${ACCENT};">support@aivastra.com</a></p>
    <p style="font-size:14px;color:#555;margin:0 0 24px;">📱 WhatsApp: +91 7729883692</p>
    ${signOff()}
  `;
  return emailShell(content);
}

function resetHtml(link: string, name?: string | null): string {
  const content = `
    ${banner('Reset your password')}
    <p style="font-size:14px;color:#555;margin:0 0 16px;">${greeting(name)}</p>
    <p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 8px;text-align:center;">Click the button below to reset your Aivastra password. This link expires in 1 hour.</p>
    ${button(link, 'Reset Password')}
    <p style="font-size:12px;color:#999;margin:24px 0 0;text-align:center;">If you didn't request a password reset, you can safely ignore this email.</p>
  `;
  return emailShell(content);
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
  name?: string | null;
}): string {
  const fmt = (paise: number) =>
    `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const fmtDate = (d: Date) =>
    d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const content = `
    ${banner('Payment Receipt')}
    <p style="font-size:14px;color:#555;margin:0 0 16px;">${greeting(r.name)}</p>
    <p style="font-size:14px;color:#555;margin:0 0 24px;">Thank you for your purchase! Your credits have been added to your account.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;border:1px solid #ECE9F7;border-radius:10px;overflow:hidden;">
      <tr style="background:#F3F0FD;">
        <th style="text-align:left;padding:11px 12px;color:#666;font-weight:600;font-size:11px;letter-spacing:.4px;text-transform:uppercase;border-bottom:1px solid #eee;">Description</th>
        <th style="text-align:right;padding:11px 12px;color:#666;font-weight:600;font-size:11px;letter-spacing:.4px;text-transform:uppercase;border-bottom:1px solid #eee;">Amount</th>
      </tr>
      <tr>
        <td style="padding:12px;color:#1a1a1a;">${r.planName} — ${r.credits.toLocaleString('en-IN')} Credits</td>
        <td style="padding:12px;color:#1a1a1a;text-align:right;">${fmt(r.basePaise)}</td>
      </tr>
      <tr style="background:#fafafa;">
        <td style="padding:10px 12px;color:#666;font-size:13px;">GST (18%)</td>
        <td style="padding:10px 12px;color:#666;font-size:13px;text-align:right;">${fmt(r.gstPaise)}</td>
      </tr>
      <tr style="background:#F8F6FF;border-top:2px solid ${ACCENT};">
        <td style="padding:14px 12px;color:#1a1a1a;font-weight:700;">Total Paid</td>
        <td style="padding:14px 12px;color:#1a1a1a;font-weight:700;text-align:right;">${fmt(r.totalPaise)}</td>
      </tr>
    </table>
    <div style="background:#F3F0FD;border-left:4px solid ${ACCENT};border-radius:10px;padding:16px 16px 16px 14px;font-size:13px;color:#555;line-height:1.8;">
      <div><span style="color:#999;">Date:</span> <strong style="color:#1a1a1a;">${fmtDate(r.paidAt)}</strong></div>
      <div><span style="color:#999;">Order ID:</span> <strong style="color:#1a1a1a;">${r.razorpayOrderId}</strong></div>
      <div><span style="color:#999;">Payment ID:</span> <strong style="color:#1a1a1a;">${r.razorpayPaymentId}</strong></div>
    </div>
    <p style="font-size:12px;color:#999;margin:24px 0 0;text-align:center;">If you have any questions, reply to this email or contact support.</p>
  `;
  return emailShell(content);
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
  name?: string | null,
): Promise<void> {
  const link = `${webUrl}/verify-email/confirm?token=${token}`;
  await send(apiKey, {
    from,
    to,
    subject: 'Verify your Aivastra account',
    html: verifyHtml(link, name),
  });
}

export async function sendWelcomeEmail(
  apiKey: string,
  from: string,
  to: string,
  displayName?: string | null,
): Promise<void> {
  await send(apiKey, {
    from,
    to,
    subject: 'Thank You for Signing Up with AI Vastra',
    html: welcomeHtml(displayName),
  });
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
    name?: string | null;
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
  name?: string | null,
): Promise<void> {
  const link = `${webUrl}/reset-password?token=${token}`;
  await send(apiKey, {
    from,
    to,
    subject: 'Reset your Aivastra password',
    html: resetHtml(link, name),
  });
}

function userLowCreditsHtml(name?: string | null): string {
  const content = `
    ${banner('Your AI Vastra Credits Are Running Low 🚨', '#7C2D12')}
    <p style="font-size:14px;color:#555;margin:0 0 16px;">${greeting(name)}</p>
    <p style="font-size:14px;color:#555;margin:0 0 16px;">Your AI Vastra credits are running low.</p>
    <p style="font-size:14px;color:#555;margin:0 0 16px;">Keep creating amazing AI catalogue photoshoots and offering Virtual Try-On to your customers without interruption.</p>
    <p style="font-size:14px;color:#555;margin:0 0 24px;">✨ Top up your credits today and keep your fashion store running smoothly.</p>
    <p style="font-size:14px;color:#555;margin:0 0 16px;">Need help choosing the right package? Our team is happy to assist.</p>
    <p style="font-size:14px;color:#555;margin:0 0 4px;">📧 <a href="mailto:support@aivastra.com" style="color:${ACCENT};">support@aivastra.com</a></p>
    <p style="font-size:14px;color:#555;margin:0 0 24px;">📱 WhatsApp: +91 7729883692</p>
    <p style="font-size:14px;color:#555;margin:0 0 24px;">Keep creating. Keep selling with AI Vastra! 🚀</p>
    ${signOff()}
  `;
  return emailShell(content);
}

export async function sendUserLowCreditsEmail(
  apiKey: string,
  from: string,
  to: string,
  displayName?: string | null,
): Promise<void> {
  await send(apiKey, {
    from,
    to,
    subject: 'Your AI Vastra Credits Are Running Low',
    html: userLowCreditsHtml(displayName),
  });
}

function reportReceivedHtml(name?: string | null): string {
  const content = `
    ${banner('Thank you for reporting the issue 🙏')}
    <p style="font-size:14px;color:#555;margin:0 0 16px;">${greeting(name)}</p>
    <p style="font-size:14px;color:#555;margin:0 0 16px;">We've received your report and our team will review the result. Your feedback helps us improve AI Vastra and deliver better results.</p>
    <p style="font-size:14px;color:#555;margin:0 0 16px;">If you need any further assistance, please contact our support team.</p>
    <p style="font-size:14px;color:#555;margin:0 0 4px;">📧 <a href="mailto:support@aivastra.com" style="color:${ACCENT};">support@aivastra.com</a></p>
    <p style="font-size:14px;color:#555;margin:0 0 24px;">📱 WhatsApp: +91 7729883692</p>
    <p style="font-size:14px;color:#555;margin:0 0 24px;">Keep creating. Keep selling with AI Vastra! 🚀</p>
    ${signOff()}
  `;
  return emailShell(content);
}

export async function sendReportReceivedEmail(
  apiKey: string,
  from: string,
  to: string,
  name?: string | null,
): Promise<void> {
  await send(apiKey, {
    from,
    to,
    subject: 'Report notification',
    html: reportReceivedHtml(name),
  });
}

// Contact-request message is free-form user text going straight into HTML —
// escape it so a stray `<`/`&` in what someone typed can't break the markup.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Personalizes the opening line when we have the signup/contact-form name on
// hand; falls back to a plain "Hi," rather than an awkward "Hi ,". The name is
// user-supplied free text, so it goes through the same escaping as any other.
function greeting(name?: string | null): string {
  const trimmed = name?.trim();
  return trimmed ? `Hi ${escapeHtml(trimmed)},` : 'Hi,';
}

function issueResolvedHtml(issueDescription: string, name?: string | null): string {
  const content = `
    ${banner('Your Reported Issue Has Been Resolved! 🎉')}
    <p style="font-size:14px;color:#555;margin:0 0 16px;">${greeting(name)}</p>
    <p style="font-size:14px;color:#555;margin:0 0 16px;">Great news! 🎉 Your reported issue has been resolved. ✅</p>
    <p style="font-size:14px;color:#1a1a1a;font-weight:700;margin:0 0 8px;">Resolved Issue Details</p>
    <div style="background:#F3F0FD;border-left:4px solid ${ACCENT};border-radius:10px;padding:16px 16px 16px 14px;font-size:14px;color:#555;margin:0 0 16px;">
      <strong style="color:#1a1a1a;">Issue:</strong> ${escapeHtml(issueDescription)}
    </div>
    <p style="font-size:14px;color:#555;margin:0 0 16px;">Our team has reviewed and resolved the issue. You can now continue using AI Vastra without interruption.</p>
    <p style="font-size:14px;color:#555;margin:0 0 16px;">✨ If you experience any further issues, our team is always here to help.</p>
    <p style="font-size:14px;color:#555;margin:0 0 4px;">📧 <a href="mailto:support@aivastra.com" style="color:${ACCENT};">support@aivastra.com</a></p>
    <p style="font-size:14px;color:#555;margin:0 0 24px;">📱 WhatsApp: +91 7729883692</p>
    <p style="font-size:14px;color:#555;margin:0 0 24px;">Keep creating. Keep selling with AI Vastra! 🚀</p>
    ${signOff()}
  `;
  return emailShell(content);
}

export async function sendIssueResolvedEmail(
  apiKey: string,
  from: string,
  to: string,
  issueDescription: string,
  name?: string | null,
): Promise<void> {
  await send(apiKey, {
    from,
    to,
    subject: 'Your Reported Issue Has Been Resolved! 🎉',
    html: issueResolvedHtml(issueDescription, name),
  });
}

function lowCreditsHtml(p: {
  appUrl: string;
  level: 'warning' | 'critical' | 'empty';
  balance: number;
  tryOnsRemaining: number;
  daysRemaining: number | null;
  name?: string | null;
}): string {
  const accent = p.level === 'warning' ? '#b26a00' : '#b42318';
  const heading =
    p.level === 'empty'
      ? "You're out of try-on credits"
      : p.level === 'critical'
        ? 'Your try-on credits run out in about a day'
        : 'Your try-on credits are running low';

  // Only stated when there is a real burn rate behind it. Saying "about 0 days"
  // because nothing has been generated recently would be wrong and alarming.
  const runwayLine =
    p.daysRemaining != null && p.level !== 'empty'
      ? `<p style="font-size:14px;color:#555;margin:0 0 8px;">At your current rate that's about <strong>${Math.max(1, Math.round(p.daysRemaining))} more day${Math.round(p.daysRemaining) === 1 ? '' : 's'}</strong>.</p>`
      : '';

  const bodyText =
    p.level === 'empty'
      ? 'Try-on has stopped for shoppers on your store. Adding credits turns it straight back on — nothing else needs reconfiguring.'
      : 'When your balance reaches zero, the try-on button stops working for shoppers on your store. Topping up now avoids that.';

  const content = `
    ${banner(heading, accent)}
    <p style="font-size:14px;color:#555;margin:0 0 16px;">${greeting(p.name)}</p>
    <p style="font-size:14px;color:#555;margin:0 0 8px;">
      Your store has <strong style="color:#1a1a1a;">${p.balance.toLocaleString()} credits</strong> left —
      about <strong style="color:#1a1a1a;">${p.tryOnsRemaining.toLocaleString()} try-ons</strong>.
    </p>
    ${runwayLine}
    <p style="font-size:14px;color:#555;margin:16px 0 28px;">${bodyText}</p>
    ${button(p.appUrl, 'Add credits')}
    <p style="font-size:12px;color:#999;margin:24px 0 0;text-align:center;">Credits never expire — anything you buy stays on your account until you use it.</p>
  `;
  return emailShell(content);
}

export async function sendLowCreditsEmail(
  apiKey: string,
  from: string,
  to: string,
  params: {
    shopDomain: string;
    appUrl: string;
    level: 'warning' | 'critical' | 'empty';
    balance: number;
    tryOnsRemaining: number;
    daysRemaining: number | null;
    name?: string | null;
  },
): Promise<void> {
  const subject =
    params.level === 'empty'
      ? `${params.shopDomain} is out of try-on credits`
      : params.level === 'critical'
        ? `${params.shopDomain}: try-on credits run out in about a day`
        : `${params.shopDomain}: try-on credits running low`;

  await send(apiKey, { from, to, subject, html: lowCreditsHtml(params) });
}

/**
 * The 90%-of-ceiling warning, from Shopify's
 * app_subscriptions/approaching_capped_amount webhook.
 *
 * Deliberately not phrased as a problem. The merchant set this ceiling on
 * purpose and it is doing its job; the only thing they need to know is that
 * auto-refill will stop when it is reached, while there is still time to raise
 * it. Warning tone, not alarm.
 */
function capApproachingHtml(p: {
  appUrl: string;
  cappedAmountUsd: number;
  balanceUsedUsd: number | null;
  name?: string | null;
}): string {
  const spent =
    p.balanceUsedUsd != null
      ? `<p style="font-size:14px;color:#555;margin:0 0 8px;">You've used <strong style="color:#1a1a1a;">$${p.balanceUsedUsd.toFixed(2)}</strong> of your <strong style="color:#1a1a1a;">$${p.cappedAmountUsd.toFixed(2)}</strong> monthly auto-refill limit this cycle.</p>`
      : `<p style="font-size:14px;color:#555;margin:0 0 8px;">You're close to your <strong style="color:#1a1a1a;">$${p.cappedAmountUsd.toFixed(2)}</strong> monthly auto-refill limit for this cycle.</p>`;

  const content = `
    ${banner("You're nearing your auto-refill limit", '#b26a00')}
    <p style="font-size:14px;color:#555;margin:0 0 16px;">${greeting(p.name)}</p>
    ${spent}
    <p style="font-size:14px;color:#555;margin:16px 0 28px;">
      When the limit is reached, auto-refill stops for the rest of this billing cycle and your
      credits will run down without topping up. You can raise the limit in the app, or leave it
      as is — it resets at the start of your next cycle.
    </p>
    ${button(p.appUrl, 'Review auto-refill')}
    <p style="font-size:12px;color:#999;margin:24px 0 0;text-align:center;">This limit is the ceiling you approved — we can never charge past it without asking you again.</p>
  `;
  return emailShell(content);
}

export async function sendAutorefillCapApproachingEmail(
  apiKey: string,
  from: string,
  to: string,
  params: {
    shopDomain: string;
    appUrl: string;
    cappedAmountUsd: number;
    balanceUsedUsd: number | null;
    name?: string | null;
  },
): Promise<void> {
  await send(apiKey, {
    from,
    to,
    subject: `${params.shopDomain}: nearing your auto-refill spending limit`,
    html: capApproachingHtml(params),
  });
}

// Three stages are wired up ('seven_day', 'three_day', 'expired') — adding
// another one later is one more branch here plus one more rank value in the
// scheduler, not a redesign.
export type UnlimitedPlanReminderStage = 'seven_day' | 'three_day' | 'expired';

function unlimitedPlanReminderHtml(p: {
  stage: UnlimitedPlanReminderStage;
  endDateLabel: string;
  daysRemaining: number;
  name?: string | null;
}): string {
  const accent =
    p.stage === 'expired' ? '#7c2d12' : p.stage === 'three_day' ? '#b42318' : '#b26a00';
  const heading =
    p.stage === 'expired'
      ? 'Your monthly plan has expired'
      : `Your monthly plan ends in ${p.daysRemaining} day${p.daysRemaining === 1 ? '' : 's'}`;
  const bodyText =
    p.stage === 'expired'
      ? `Your AI Vastra monthly plan expired on <strong style="color:#1a1a1a;">${p.endDateLabel}</strong>. Your account is now using your regular credit balance.`
      : `Your AI Vastra monthly plan is active until <strong style="color:#1a1a1a;">${p.endDateLabel}</strong>. After that, your account goes back to using your regular credit balance.`;
  const ctaText =
    p.stage === 'expired'
      ? 'Reach out to us to renew your plan.'
      : "Reach out to us if you'd like to extend your plan.";

  const content = `
    ${banner(heading, accent)}
    <p style="font-size:14px;color:#555;margin:0 0 16px;">${greeting(p.name)}</p>
    <p style="font-size:14px;color:#555;margin:0 0 16px;">
      ${bodyText}
    </p>
    <p style="font-size:14px;color:#555;margin:0 0 24px;">${ctaText}</p>
    <p style="font-size:14px;color:#555;margin:0 0 4px;">📧 <a href="mailto:support@aivastra.com" style="color:${ACCENT};">support@aivastra.com</a></p>
    <p style="font-size:14px;color:#555;margin:0 0 24px;">📱 WhatsApp: +91 7729883692</p>
    ${signOff()}
  `;
  return emailShell(content);
}

export async function sendUnlimitedPlanReminderEmail(
  apiKey: string,
  from: string,
  to: string,
  params: {
    stage: UnlimitedPlanReminderStage;
    endDateLabel: string;
    daysRemaining: number;
    name?: string | null;
  },
): Promise<void> {
  const subject =
    params.stage === 'expired'
      ? 'Your monthly plan has expired'
      : `Your monthly plan ends in ${params.daysRemaining} day${params.daysRemaining === 1 ? '' : 's'}`;

  await send(apiKey, { from, to, subject, html: unlimitedPlanReminderHtml(params) });
}

function refundDecisionHtml(p: {
  approved: boolean;
  credits: number;
  adminNote: string | null;
  name?: string | null;
}): string {
  const heading = p.approved
    ? 'Your refund request was approved'
    : 'Your refund request was declined';
  const body = p.approved
    ? `We've returned <strong style="color:#1a1a1a;">${p.credits.toLocaleString()} credits</strong> to your account.`
    : "We reviewed your request and weren't able to refund this image.";
  const note = p.adminNote
    ? `<p style="font-size:14px;color:#555;margin:16px 0 0;"><strong>Note from our team:</strong> ${escapeHtml(p.adminNote)}</p>`
    : '';
  const content = `
    ${banner(heading, p.approved ? BANNER_BG : '#7C2D12')}
    <p style="font-size:14px;color:#555;margin:0 0 16px;">${greeting(p.name)}</p>
    <p style="font-size:14px;color:#555;margin:0;text-align:center;">${body}</p>
    ${note}
    <p style="font-size:12px;color:#999;margin:24px 0 0;text-align:center;">If you have questions, just reply to this email or contact support from the app.</p>
  `;
  return emailShell(content);
}

export async function sendRefundDecisionEmail(
  apiKey: string,
  from: string,
  to: string,
  p: { approved: boolean; credits: number; adminNote: string | null; name?: string | null },
): Promise<void> {
  await send(apiKey, {
    from,
    to,
    subject: p.approved ? 'Your refund request was approved' : 'Your refund request was declined',
    html: refundDecisionHtml(p),
  });
}
