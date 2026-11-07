import { apiFetch } from './api';
import { httpStatusMessage } from './errors';

// Thin wrappers over apiFetch so the ported catalogue UI inherits Bearer auth,
// single-flight refresh and the 403 account re-check. Signatures mirror
// catalogues-web's `api` object; only the methods the catalogue manager uses.
export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  // Resolves undefined on 204 (readResponseBody returns undefined for an empty body).
  del: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
  /**
   * PUT straight to the presigned storage URL. Deliberately NOT apiFetch: the
   * presigned URL is not our API, so it must carry no Authorization header and
   * no cookies.
   */
  uploadToR2: async (uploadUrl: string, file: File): Promise<void> => {
    let res: Response;
    try {
      res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
    } catch {
      throw new Error('Unable to upload the file. Check your connection and try again.');
    }
    if (!res.ok) throw new Error(httpStatusMessage(res.status));
  },
};
