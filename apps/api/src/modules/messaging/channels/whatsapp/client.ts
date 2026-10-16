// Thin Graph API client. Knows HTTP and Meta's error shape, nothing about the
// conversation. Never logs request headers: they carry the access token.
export const META_ERROR_OUTSIDE_WINDOW = 131047;

export class MetaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

export interface WhatsappClient {
  /** `to` is the wa_id: E.164 digits without '+'. */
  send(to: string, payload: Record<string, unknown>): Promise<{ messageId: string }>;
  uploadMedia(bytes: Buffer, mimeType: string): Promise<string>;
  downloadMedia(mediaId: string, maxBytes: number): Promise<{ bytes: Buffer; mimeType: string }>;
}

export interface WhatsappClientConfig {
  phoneNumberId: string;
  accessToken: string;
  graphVersion: string;
  fetchImpl?: typeof fetch;
}

async function failure(res: Response): Promise<MetaApiError> {
  let code: number | undefined;
  let message = `Graph API ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { code?: number; message?: string } };
    code = body.error?.code;
    if (body.error?.message) message = body.error.message;
  } catch {
    // non-JSON error body: keep the status-only message
  }
  return new MetaApiError(res.status, code, message);
}

export function createWhatsappClient(cfg: WhatsappClientConfig): WhatsappClient {
  const doFetch = cfg.fetchImpl ?? fetch;
  const base = `https://graph.facebook.com/${cfg.graphVersion}`;
  const auth = { Authorization: `Bearer ${cfg.accessToken}` };

  return {
    async send(to, payload) {
      const res = await doFetch(`${base}/${cfg.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          ...payload,
        }),
      });
      if (!res.ok) throw await failure(res);
      const body = (await res.json()) as { messages?: { id: string }[] };
      return { messageId: body.messages?.[0]?.id ?? '' };
    },

    async uploadMedia(bytes, mimeType) {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', mimeType);
      // Copy into a fresh Uint8Array: Buffer may be SharedArrayBuffer-backed,
      // which the DOM BlobPart type rejects.
      const view = new Uint8Array(bytes.length);
      view.set(bytes);
      form.append('file', new Blob([view], { type: mimeType }), 'image');
      const res = await doFetch(`${base}/${cfg.phoneNumberId}/media`, {
        method: 'POST',
        headers: auth,
        body: form,
      });
      if (!res.ok) throw await failure(res);
      return ((await res.json()) as { id: string }).id;
    },

    async downloadMedia(mediaId, maxBytes) {
      // Two steps: the media id resolves to a short-lived URL, which also needs the token.
      const meta = await doFetch(`${base}/${mediaId}`, { headers: auth });
      if (!meta.ok) throw await failure(meta);
      const info = (await meta.json()) as { url: string; mime_type: string; file_size?: number };
      if ((info.file_size ?? 0) > maxBytes)
        throw new MetaApiError(413, undefined, 'media too large');
      const file = await doFetch(info.url, { headers: auth });
      if (!file.ok) throw await failure(file);
      const bytes = Buffer.from(await file.arrayBuffer());
      if (bytes.length > maxBytes) throw new MetaApiError(413, undefined, 'media too large');
      return { bytes, mimeType: info.mime_type };
    },
  };
}
