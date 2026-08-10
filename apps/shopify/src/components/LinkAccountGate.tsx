import { Banner, BlockStack, Button, Card, Page, Text } from '@shopify/polaris';
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
    <Page narrowWidth>
      <Card>
        <BlockStack gap="400">
          <BlockStack gap="100">
            <Text as="h1" variant="headingLg">
              Connect your AiVastra account
            </Text>
            <Text as="p" tone="subdued">
              Link your store to start offering virtual try-on.
            </Text>
          </BlockStack>

          {error && (
            <Banner tone="critical" title="Couldn't complete the connection">
              Please try linking your account again.
            </Banner>
          )}

          <Button variant="primary" size="large" loading={linking} onClick={link} fullWidth>
            Link account
          </Button>

          <Text as="p" tone="subdued" alignment="center" variant="bodySm">
            You'll be redirected to app.aivastra.com to sign in
          </Text>
        </BlockStack>
      </Card>
    </Page>
  );
}
