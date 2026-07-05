import { apiFetch } from './api';
import { makeThumbnail } from './thumbnail';

export type UploadPhase = 'uploading-main' | 'uploading-thumbnail' | 'confirming' | null;

export async function uploadFile(
  uploadUrl: string,
  fileUri: string,
  contentType: string,
  onProgress?: (progress: number) => void,
): Promise<void> {
  const blob = await fetch(fileUri).then((response) => response.blob());
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(blob);
  });
}

interface TwoImageOpts {
  presignEndpoint: string;
  presignBody: object;
  fileUri: string;
  contentType: string;
  confirmEndpoint: string;
  confirmMethod?: 'POST' | 'PATCH';
  confirmBody: (keys: { r2Key: string; thumbnailKey: string }) => object;
  onProgress?: (phase: Exclude<UploadPhase, null>, progress: number) => void;
}

export async function uploadTwoImage<T = unknown>(opts: TwoImageOpts): Promise<T> {
  const signed = await apiFetch<{
    uploadUrl: string;
    r2Key: string;
    thumbnailUploadUrl: string;
    thumbnailKey: string;
  }>(opts.presignEndpoint, { method: 'POST', body: JSON.stringify(opts.presignBody) });
  await uploadFile(signed.uploadUrl, opts.fileUri, opts.contentType, (progress) =>
    opts.onProgress?.('uploading-main', progress),
  );
  const thumbnailUri = await makeThumbnail(opts.fileUri);
  await uploadFile(signed.thumbnailUploadUrl, thumbnailUri, 'image/jpeg', (progress) =>
    opts.onProgress?.('uploading-thumbnail', progress),
  );
  opts.onProgress?.('confirming', 100);
  return apiFetch<T>(opts.confirmEndpoint, {
    method: opts.confirmMethod ?? 'POST',
    body: JSON.stringify(
      opts.confirmBody({ r2Key: signed.r2Key, thumbnailKey: signed.thumbnailKey }),
    ),
  });
}

interface SingleThumbOpts {
  presignEndpoint: string;
  presignBody: object;
  fileUri: string;
  onProgress?: (progress: number) => void;
}

export async function uploadSingleThumb(opts: SingleThumbOpts): Promise<{ thumbnailKey: string }> {
  const signed = await apiFetch<{ uploadUrl: string; thumbnailKey: string }>(opts.presignEndpoint, {
    method: 'POST',
    body: JSON.stringify(opts.presignBody),
  });
  const thumbnailUri = await makeThumbnail(opts.fileUri);
  await uploadFile(signed.uploadUrl, thumbnailUri, 'image/jpeg', opts.onProgress);
  return { thumbnailKey: signed.thumbnailKey };
}
