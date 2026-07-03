import type { EmbedFn } from '../server.js';

const BATCH = 100;

export function makeOpenAiEmbedder(apiKey: string, model: string): EmbedFn {
  return async (texts) => {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const chunk = texts.slice(i, i + BATCH);
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model, input: chunk }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`openai embeddings ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as Record<string, unknown>;
      if (!Array.isArray(body?.data))
        throw new Error('openai embeddings: unexpected response shape');
      const data = body.data as { index: number; embedding: number[] }[];
      if (data.length !== chunk.length)
        throw new Error(`openai embeddings: expected ${chunk.length} results, got ${data.length}`);
      out.push(...data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
    }
    return out;
  };
}
