'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface OrderResponse {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  credits: number;
  label: string;
}

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const RAZORPAY_SDK = 'https://checkout.razorpay.com/v1/checkout.js';

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false);
    if (window.Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = RAZORPAY_SDK;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export function UpgradeButton({ planSlug, planName }: { planSlug: string; planName: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  async function upgrade() {
    setLoading(true);
    setMessage(null);
    try {
      // 1. Create the order server-side (amount computed from trusted billing data)
      const res = await fetch('/api/merchant/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planSlug }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const notConfigured = res.status === 503 || data?.error?.code === 'NOT_CONFIGURED';
        setMessage({
          kind: 'info',
          text: notConfigured
            ? `Online payment isn’t enabled yet. Contact sales@aivastra.com to activate the ${planName} plan.`
            : (data?.error?.message ?? 'Could not start checkout. Please try again.'),
        });
        return;
      }
      const order = data as OrderResponse;

      // 2. Load Razorpay checkout
      const ready = await loadRazorpay();
      if (!ready || !window.Razorpay) {
        setMessage({ kind: 'error', text: 'Could not load the payment gateway. Please retry.' });
        return;
      }

      // 3. Open Razorpay; verify server-side on success
      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'Ai Vastra',
        description: `${order.label} Plan — ${order.credits.toLocaleString('en-IN')} credits`,
        order_id: order.orderId,
        handler: async (response: RazorpayResponse) => {
          setLoading(true);
          try {
            const vr = await fetch('/api/merchant/payments/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              }),
            });
            if (!vr.ok) {
              setMessage({
                kind: 'error',
                text: 'Payment captured but verification failed. Contact support if credits don’t appear.',
              });
              return;
            }
            router.push('/dashboard?payment=success');
          } catch {
            setMessage({ kind: 'error', text: 'Verification error. Please contact support.' });
          } finally {
            setLoading(false);
          }
        },
        modal: {
          ondismiss: () => setLoading(false),
        },
        theme: { color: '#7c5cfc' },
      });
      rzp.open();
    } catch {
      setMessage({ kind: 'error', text: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={upgrade}
        disabled={loading}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'center',
          padding: '12px 20px',
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 700,
          border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1,
          background: 'var(--c-merchant-accent)',
          color: 'var(--c-white)',
          fontFamily: 'inherit',
        }}
      >
        {loading ? 'Processing…' : 'Upgrade Plan'}
      </button>
      {message && (
        <p
          style={{
            margin: '12px 0 0',
            fontSize: 12.5,
            lineHeight: 1.5,
            textAlign: 'center',
            color:
              message.kind === 'error'
                ? 'var(--c-merchant-danger)'
                : 'var(--c-merchant-text-muted)',
          }}
        >
          {message.text}
        </p>
      )}
    </>
  );
}
