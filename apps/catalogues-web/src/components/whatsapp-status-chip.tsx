'use client';

import Link from 'next/link';
import { useWhatsappStatus } from '@/hooks/use-whatsapp-status';
import { C } from './tokens';

// D27: the studio shows whether WhatsApp is connected. Both states link to
// Settings, where connect / disconnect live — the chip itself changes nothing.
export function WhatsappStatusChip() {
  const { data } = useWhatsappStatus();
  if (!data?.enabled) return null;
  const connected = data.accounts.some((a) => !a.optedOut);
  return (
    <Link
      href="/settings"
      style={{
        padding: '4px 10px',
        borderRadius: 99,
        fontSize: 12,
        fontWeight: 600,
        textDecoration: 'none',
        border: `1px solid ${connected ? C.mint : C.border}`,
        color: connected ? C.mint : C.mid,
        whiteSpace: 'nowrap',
      }}
    >
      {connected ? 'WhatsApp connected' : 'Connect WhatsApp'}
    </Link>
  );
}
