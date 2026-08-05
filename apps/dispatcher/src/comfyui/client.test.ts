import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadOutputImage } from './client.js';

describe('downloadOutputImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes the subfolder in the /view request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    });
    vi.stubGlobal('fetch', fetchMock);

    // ComfyUI's SaveImage counter resets per subfolder — two different jobs
    // can legitimately produce the same filename in different subfolders.
    // Omitting subfolder from /view risks fetching a different job's image.
    await downloadOutputImage('https://worker.example', 'key', 'ComfyUI_00001_.png', 'job-a');

    const requestedUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(requestedUrl).toContain('subfolder=job-a');
    expect(requestedUrl).toContain('filename=ComfyUI_00001_.png');
  });

  it('defaults to an empty subfolder when the caller omits one', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    });
    vi.stubGlobal('fetch', fetchMock);

    await downloadOutputImage('https://worker.example', 'key', 'result.png');

    const requestedUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(requestedUrl).toContain('subfolder=');
  });
});
