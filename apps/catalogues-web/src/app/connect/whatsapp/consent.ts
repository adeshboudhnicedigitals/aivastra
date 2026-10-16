// Approved 2026-10-13 (spec section 14, D21). Change only with sign-off: this is
// the consent the seller gives, and messaging_accounts.opted_in_at timestamps it.
export const CONSENT_POINTS = [
  'Aivastra will send messages to this WhatsApp number about the catalog images you create here, such as questions while you set up a catalog and the finished images.',
  'The photos you send in this chat are used to generate your catalog images and are stored in your Aivastra account, the same way as photos you upload on the website.',
  'Your WhatsApp number is stored so we can recognise you in the chat. We do not use it for marketing.',
  'Images created in the chat use credits from your Aivastra account.',
] as const;
