import { Banner, BlockStack, Button, Text } from '@shopify/polaris';
import { useState } from 'react';
import { apiFetch } from '../lib/api';

const AIVASTRA_APP_URL = import.meta.env.VITE_AIVASTRA_APP_URL || 'https://app.aivastra.com';

function openLinkPopup(): Promise<string> {
  return new Promise((resolve, reject) => {
    const nonce = Math.random().toString(36).slice(2);
    const origin = window.location.origin;
    const popup = window.open(
      `${AIVASTRA_APP_URL}/login?next=${encodeURIComponent(
        `/widget-link-complete?origin=${encodeURIComponent(origin)}&nonce=${nonce}`,
      )}`,
      'aivastra-link',
      'width=480,height=640',
    );

    function onMessage(event: MessageEvent) {
      if (event.origin !== AIVASTRA_APP_URL) return;
      if (event.data?.type !== 'aivastra-widget-link' || event.data.nonce !== nonce) return;
      window.removeEventListener('message', onMessage);
      resolve(event.data.code as string);
    }
    window.addEventListener('message', onMessage);

    const closeCheck = setInterval(() => {
      if (popup?.closed) {
        clearInterval(closeCheck);
        window.removeEventListener('message', onMessage);
        reject(new Error('Popup closed before linking completed'));
      }
    }, 500);
  });
}

export function LinkAccountGate({ onLinked }: { onLinked: () => void }) {
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link() {
    setLinking(true);
    setError(null);
    try {
      const code = await openLinkPopup();
      await apiFetch('/v1/shopify/store/account/link', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      onLinked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLinking(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
      }}
    >
      <div
        style={{
          width: '420px',
          maxWidth: '100%',
          background: 'var(--p-color-bg-surface)',
          borderRadius: 'var(--p-border-radius-300)',
          boxShadow: 'var(--p-shadow-100)',
          padding: '36px 32px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '14px',
            margin: '0 auto 20px',
            background:
              'linear-gradient(135deg, var(--p-color-bg-fill-brand), var(--p-color-bg-fill-brand-hover))',
          }}
        />
        <BlockStack gap="300">
          <Text as="h1" variant="headingLg" alignment="center">
            Connect your AiVastra account
          </Text>
          <Text as="p" tone="subdued" alignment="center">
            To use AiVastra Try-On, link this store to your aivastra account. Billing and credits
            are managed on app.aivastra.com — nothing is charged through Shopify.
          </Text>
          {error && (
            <Banner tone="critical" title="Linking failed">
              {error}
            </Banner>
          )}
          <Button onClick={link} loading={linking} variant="primary" fullWidth>
            Link account
          </Button>
        </BlockStack>
      </div>
    </div>
  );
}
