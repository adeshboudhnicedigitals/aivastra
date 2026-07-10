import { Banner, BlockStack, Button, Card, Page, Text } from '@shopify/polaris';
import { useState } from 'react';
import { apiFetch } from '../lib/api';

function openLinkPopup(): Promise<string> {
  return new Promise((resolve, reject) => {
    const nonce = Math.random().toString(36).slice(2);
    const origin = window.location.origin;
    const popup = window.open(
      `https://app.aivastra.com/login?next=${encodeURIComponent(
        `/widget-link-complete?origin=${encodeURIComponent(origin)}&nonce=${nonce}`,
      )}`,
      'aivastra-link',
      'width=480,height=640',
    );

    function onMessage(event: MessageEvent) {
      if (event.origin !== 'https://app.aivastra.com') return;
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
    <Page title="Link your aivastra account">
      <Card>
        <BlockStack gap="300">
          <Text as="p">
            To use AiVastra Try-On, link this store to your aivastra account. Billing and credits
            are managed on app.aivastra.com — nothing is charged through Shopify.
          </Text>
          {error && (
            <Banner tone="critical" title="Linking failed">
              {error}
            </Banner>
          )}
          <Button onClick={link} loading={linking} variant="primary">
            Link account
          </Button>
        </BlockStack>
      </Card>
    </Page>
  );
}
