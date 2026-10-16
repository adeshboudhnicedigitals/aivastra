import { z } from 'zod';

export const MessagingChannel = z.enum(['whatsapp']);
export type MessagingChannel = z.infer<typeof MessagingChannel>;

export const MessagingAccount = z.object({
  id: z.string().uuid(),
  channel: MessagingChannel,
  // E.164. Shown in full to the account's own owner only.
  externalId: z.string(),
  optedOut: z.boolean(),
  connectedAt: z.string(),
});
export type MessagingAccount = z.infer<typeof MessagingAccount>;

export const MessagingAccountsResponse = z.object({
  // false when MESSAGING_WHATSAPP_ENABLED is off: the web hides every WhatsApp UI.
  enabled: z.boolean(),
  accounts: z.array(MessagingAccount),
});
export type MessagingAccountsResponse = z.infer<typeof MessagingAccountsResponse>;

export const WebConnectCodeResponse = z.object({
  code: z.string(),
  // Digits only, e.g. '15556585373' — what wa.me expects.
  displayNumber: z.string(),
  waLink: z.string(),
  expiresInSeconds: z.number().int(),
});
export type WebConnectCodeResponse = z.infer<typeof WebConnectCodeResponse>;

// Sent in the body, never the URL, so request logs never capture it.
export const ChatConnectTokenBody = z.object({ token: z.string().min(20).max(100) });
export type ChatConnectTokenBody = z.infer<typeof ChatConnectTokenBody>;

export const ChatConnectPreviewResponse = z.object({
  phoneMasked: z.string(),
  // D29: a hint only. Never connects or blocks anything.
  matchesProfile: z.boolean(),
  profilePhoneLast4: z.string().nullable(),
  alreadyConnected: z.boolean(),
});
export type ChatConnectPreviewResponse = z.infer<typeof ChatConnectPreviewResponse>;

export const ChatConnectConfirmResponse = z.object({ account: MessagingAccount });
export type ChatConnectConfirmResponse = z.infer<typeof ChatConnectConfirmResponse>;
