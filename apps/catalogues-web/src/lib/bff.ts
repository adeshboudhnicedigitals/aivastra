export async function safeJson(res: Response): Promise<[unknown, boolean]> {
  const text = await res.text().catch(() => '');
  try {
    return [JSON.parse(text), res.ok];
  } catch {
    return [{ error: { message: `Service unavailable (${res.status})` } }, false];
  }
}
