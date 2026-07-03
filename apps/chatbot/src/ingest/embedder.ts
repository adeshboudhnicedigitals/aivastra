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
      const json = (await res.json()) as {
        data: { index: number; embedding: number[] }[];
      };
      out.push(...json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
    }
    return out;
  };
}
