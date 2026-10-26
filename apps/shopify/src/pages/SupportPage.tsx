import { BlockStack, Button, Card, Page, Text } from '@shopify/polaris';
import { AppFont } from '../components/AppFont';

export default function SupportPage() {
  return (
    <AppFont>
      <Page title="Support" subtitle="Email us, or use the chat button at the bottom right.">
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Email support
            </Text>
            <Text as="p" tone="subdued">
              Send us the details and we usually reply within 24 hours. For a faster answer, open
              the chat in the bottom-right corner during business hours.
            </Text>
            <Button size="large" url="mailto:support@aivastra.com">
              Email us
            </Button>
          </BlockStack>
        </Card>
      </Page>
    </AppFont>
  );
}
