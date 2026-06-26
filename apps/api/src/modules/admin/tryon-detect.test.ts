import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectTryonMappings } from './tryon-detect.js';

const sample = JSON.parse(
  readFileSync(join(process.cwd(), '../../templates/tryonupper25062026 (2).json'), 'utf8'),
) as Record<string, unknown>;

describe('detectTryonMappings', () => {
  it('detects person, garment and output nodes from the sample JSON', () => {
    const { detected } = detectTryonMappings(sample);
    expect(detected.personNodeId).toBe('1000');
    expect(detected.garmentNodeId).toBe('1006');
    expect(detected.outputNodeId).toBe('994');
  });

  it('detects positive and negative prompt nodes via the positive/negative input links', () => {
    const { detected } = detectTryonMappings(sample);
    expect(detected.positivePromptNode).toBe('1001:111');
    expect(detected.negativePromptNode).toBe('1117');
  });

  it('extracts default prompt text from the detected prompt nodes', () => {
    const { detected } = detectTryonMappings(sample);
    expect(detected.defaultPositivePrompt).toContain('tryon image2 upperwear');
    expect(detected.defaultNegativePrompt).toContain('plastics hands');
  });

  it('returns the full image and prompt node lists for manual override', () => {
    const { allImageNodes, allPromptNodes } = detectTryonMappings(sample);
    expect(allImageNodes.map((n) => n.id).sort()).toEqual(['1000', '1006']);
    expect(allPromptNodes.map((n) => n.id).sort()).toEqual(['1001:111', '1117']);
  });
});
