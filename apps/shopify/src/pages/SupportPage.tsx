import { Banner, BlockStack, Button, Card, InlineGrid, Page, Text } from '@shopify/polaris';
import { useState } from 'react';
import { SupportChat } from '../components/SupportChat';

export default function SupportPage() {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <Page title="Support" subtitle="Two ways to reach the team.">
      <BlockStack gap="400">
        <Banner tone="info">
          Live chat is the fastest option during business hours. Email is answered within 24 hours
          the rest of the time.
        </Banner>
        <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Email support
              </Text>
              <Text as="p" tone="subdued">
                Send us the details and we usually reply within 24 hours.
              </Text>
              <Button url="mailto:support@aivastra.com">Email us</Button>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Live chat
              </Text>
              <Text as="p" tone="subdued">
                Talk to the team in real time during business hours.
              </Text>
              <Button onClick={() => setChatOpen(true)}>Start a chat</Button>
            </BlockStack>
          </Card>
        </InlineGrid>
      </BlockStack>
      <SupportChat open={chatOpen} onClose={() => setChatOpen(false)} />
    </Page>
  );
}
