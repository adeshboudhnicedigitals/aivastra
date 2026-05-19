export interface ComfySubmitResult {
  promptId: string;
}

export interface ComfyOutputImage {
  filename: string;
  subfolder: string;
  type: string;
}

function cfHeaders(clientId: string, clientSecret: string): Record<string, string> {
  return {
    'CF-Access-Client-Id': clientId,
    'CF-Access-Client-Secret': clientSecret,
    'Content-Type': 'application/json',
  };
}

export async function submitPrompt(
  workerUrl: string,
  clientId: string,
  clientSecret: string,
  clientUuid: string,
  prompt: Record<string, unknown>,
): Promise<ComfySubmitResult> {
  const res = await fetch(`${workerUrl}/prompt`, {
    method: 'POST',
    headers: cfHeaders(clientId, clientSecret),
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
  clientId: string,
  clientSecret: string,
  promptId: string,
): Promise<ComfyOutputImage[]> {
  const res = await fetch(`${workerUrl}/history/${promptId}`, {
    headers: { 'CF-Access-Client-Id': clientId, 'CF-Access-Client-Secret': clientSecret },
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

export async function downloadOutputImage(
  workerUrl: string,
  clientId: string,
  clientSecret: string,
  filename: string,
): Promise<Uint8Array> {
  const url = `${workerUrl}/view?filename=${encodeURIComponent(filename)}&type=output`;
  const res = await fetch(url, {
    headers: { 'CF-Access-Client-Id': clientId, 'CF-Access-Client-Secret': clientSecret },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ComfyUI /view failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}
