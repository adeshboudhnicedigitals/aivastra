const MAX_LEN = 500;

/** Mirrors the server's storeUrl rule: http(s) only, max 500 chars; empty means "clear". */
export function validateStoreUrl(v: string): string | null {
  const s = v.trim();
  if (s === '') return null;
  if (s.length > MAX_LEN) return `Store link must be ${MAX_LEN} characters or fewer.`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return 'Enter a full link, for example https://yourstore.com.';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return 'The link must start with http:// or https://.';
  }
  return null;
}

/** The PATCH body value: trimmed, empty becomes null (clear). */
export function toStoreUrlPayload(v: string): string | null {
  const s = v.trim();
  return s === '' ? null : s;
}
