export function promptGuard(s: string | undefined): string | null {
  if (!s) return null;
  return s.replace(/[\x00-\x1F\x7F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}
