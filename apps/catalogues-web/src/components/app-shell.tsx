'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChatWidget } from '@/components/chat-widget';
import { ProfileGate } from '@/components/profile-gate';
import { Sidebar } from '@/components/sidebar';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// The /shopify-plugin mock page renders its own full Shopify admin chrome,
// including its own left nav rail — showing the real Ai Vastra Sidebar at
// the same time makes two sidebars collide visually. Hide it on that route
// by default, with a floating toggle so the merchant (or a demo presenter)
// can still get back to the rest of the app without navigating away.
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const path = BASE && pathname?.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  const isShopifyPlugin = path === '/shopify-plugin' || path?.startsWith('/shopify-plugin/');
  const [sidebarVisible, setSidebarVisible] = useState(!isShopifyPlugin);

  useEffect(() => {
    setSidebarVisible(!isShopifyPlugin);
  }, [isShopifyPlugin]);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      {sidebarVisible && <Sidebar />}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ProfileGate>{children}</ProfileGate>
      </div>
      {process.env.NODE_ENV === 'development' && <ChatWidget />}
      {isShopifyPlugin && (
        <button
          type="button"
          onClick={() => setSidebarVisible((v) => !v)}
          style={{
            position: 'fixed',
            bottom: 16,
            left: 16,
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: 36,
            padding: '0 16px',
            borderRadius: 999,
            border: 'none',
            background: 'linear-gradient(135deg, #7c3aed 0%, #BD2587 100%)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
        >
          {sidebarVisible ? 'Hide Ai Vastra Sidebar' : 'Show Ai Vastra Sidebar'}
        </button>
      )}
    </div>
  );
}
