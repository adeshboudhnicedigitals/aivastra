import { api } from '@/lib/api';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Presigns and uploads one file, resolving to its R2 key. Each call gets its own
 * key from /v1/uploads/presign (the UUID in the key is a per-upload token, not
 * the user id), so parallel uploads never collide.
 */
export async function uploadTrayFile(
  file: File,
  onProgress: (pct: number) => void,
): Promise<string> {
  const { uploadUrl, r2Key } = await api.post<{
    uploadUrl: string;
    r2Key: string;
    expiresIn: number;
  }>('/v1/uploads/presign', { contentType: file.type, contentLength: file.size });
  await api.uploadToR2WithProgress(uploadUrl, file, onProgress);
  return r2Key;
}
