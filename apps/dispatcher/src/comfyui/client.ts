export interface ComfySubmitResult {
  promptId: string;
}

export interface ComfyOutputImage {
  filename: string;
  subfolder: string;
  type: string;
}

function apiHeaders(apiKey: string): Record<string, string> {
  return {
    'X-Api-Key': apiKey,
    'Content-Type': 'application/json',
  };
}

export async function submitPrompt(
  workerUrl: string,
  apiKey: string,
  clientUuid: string,
  prompt: Record<string, unknown>,
): Promise<ComfySubmitResult> {
  const res = await fetch(`${workerUrl}/prompt`, {
    method: 'POST',
    headers: apiHeaders(apiKey),
    body: JSON.stringify({ prompt, client_id: clientUuid }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ComfyUI /prompt failed: ${res.status} ${text}`);
  }
  const json = await res.json() as { prompt_id: string };
  return { promptId: json.prompt_id };
}

export async function fetchHistory(
  workerUrl: string,
  apiKey: string,
  promptId: string,
): Promise<ComfyOutputImage[]> {
  const res = await fetch(`${workerUrl}/history/${promptId}`, {
    headers: { 'X-Api-Key': apiKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ComfyUI /history failed: ${res.status}`);
  const history = await res.json() as Record<string, unknown>;
  const entry = history[promptId] as { outputs?: Record<string, { images?: ComfyOutputImage[] }> } | undefined;
  if (!entry?.outputs) return [];
  const images: ComfyOutputImage[] = [];
  for (const node of Object.values(entry.outputs)) {
    if (node.images) images.push(...node.images);
  }
  return images;
}

/**
 * Uploads an image to ComfyUI's input folder via /upload/image.
 * Returns the filename ComfyUI assigned (use this in LoadImage nodes).
 */
export async function uploadImageToComfy(
  workerUrl: string,
  apiKey: string,
  imageBytes: Uint8Array,
  filename: string,
  contentType: string,
): Promise<string> {
  const form = new FormData();
  form.append('image', new Blob([imageBytes], { type: contentType }), filename);
  form.append('overwrite', 'true');
  const res = await fetch(`${workerUrl}/upload/image`, {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey }, // no Content-Type — FormData sets multipart boundary
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ComfyUI /upload/image failed: ${res.status} ${text}`);
  }
  const json = await res.json() as { name: string };
  return json.name;
}

export async function downloadOutputImage(
  workerUrl: string,
  apiKey: string,
  filename: string,
): Promise<Uint8Array> {
  const url = `${workerUrl}/view?filename=${encodeURIComponent(filename)}&type=output`;
  const res = await fetch(url, {
    headers: { 'X-Api-Key': apiKey },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ComfyUI /view failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}
