// "<nonce>|<action>|<value>". The nonce ties a tap to the prompt that offered
// it; values are UUIDs, small integers or short enum strings, never containing '|'.
const SEP = '|';

export function encodeReplyId(nonce: string, action: string, value = ''): string {
  return [nonce, action, value].join(SEP);
}

export function decodeReplyId(id: string): { nonce: string; action: string; value: string } | null {
  const parts = id.split(SEP);
  if (parts.length !== 3) return null;
  const [nonce, action, value] = parts;
  return { nonce, action, value };
}
