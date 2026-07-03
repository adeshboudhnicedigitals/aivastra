import type { EmbedFn } from '../server.js';

export function makeOpenAiEmbedder(_apiKey: string, _model: string): EmbedFn {
  return async (texts) => texts.map(() => []);
}
