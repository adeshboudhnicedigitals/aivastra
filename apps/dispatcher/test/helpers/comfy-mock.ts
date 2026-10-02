import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';

export interface ComfyMockOptions {
  fail?: boolean;
  startDelayMs?: number;
  comfyVersion?: string;
  deleteStatus?: number;
  interruptStatus?: number;
  /** Runs before each response so a test can revoke Redis capabilities mid-wait. */
  onRequest?: (method: string, path: string) => void | Promise<void>;
  completionDelayMs?: number;
  outputFilename?: string;
  outputBytes?: Uint8Array;
  /** GET /prompt `exec_info.queue_remaining` (default 0) — what a dev's browser run looks like. */
  queueRemaining?: number;
  /** GET /queue entry counts (default 0/0). */
  queueRunning?: number;
  queuePending?: number;
  /** Force GET /queue to answer with this HTTP status instead of 200. */
  queueStatus?: number;
  /** Force GET /prompt to answer with this HTTP status instead of 200. */
  promptStatus?: number;
  /** Force GET /prompt to answer with this raw body (e.g. invalid JSON). */
  promptBody?: string;
}

export interface ComfyMock {
  url: string;
  lastPromptId: () => string | null;
  deleteCalls: () => string[][];
  interruptCalls: () => Array<string | undefined>;
  /** The full `{ prompt, client_id }` body of the most recent POST /prompt — lets
   *  tests assert on the actual patched workflow JSON rather than network I/O. */
  lastPrompt: () => { prompt: Record<string, { inputs?: Record<string, unknown> }> } | null;
  /** Original filenames (e.g. `accessory_<jobId>.png`) from every POST /upload/image
   *  call so far, in call order — lets tests assert how MANY uploads of a given kind
   *  actually hit ComfyUI, not just what the final patched workflow looks like. */
  uploadedFilenames: () => string[];
  setOptions: (opts: ComfyMockOptions) => void;
  resetPrompts: () => void;
  close: () => Promise<void>;
}

export function startComfyMock(): Promise<ComfyMock> {
  return new Promise((resolve, reject) => {
    let opts: ComfyMockOptions = {};
    let lastPromptId: string | null = null;
    let lastPrompt: { prompt: Record<string, { inputs?: Record<string, unknown> }> } | null = null;
    // Monotonic counter (not Date.now()) so two uploads racing in the same
    // Promise.all in the same millisecond still get distinguishable filenames.
    let uploadSeq = 0;
    const uploadedFilenames: string[] = [];
    let promptSeq = 0;
    const deleted: string[][] = [];
    const interrupted: Array<string | undefined> = [];
    const prompts = new Map<string, { startAt: number; finishAt: number; removed: boolean }>();
    const histories: Record<string, unknown> = {};
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      await opts.onRequest?.(req.method ?? '', url.pathname);

      if (req.method === 'GET' && url.pathname === '/system_stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            system: { python_version: '3.10', comfyui_version: opts.comfyVersion ?? '0.37.0' },
          }),
        );
        return;
      }

      if (req.method === 'GET' && url.pathname === '/queue') {
        res.writeHead(opts.queueStatus ?? 200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            queue_running: [
              ...Array.from({ length: opts.queueRunning ?? 0 }, (_, i) => [
                i,
                `foreign-running-${i}`,
              ]),
              ...[...prompts]
                .filter(([, p]) => !p.removed && Date.now() >= p.startAt && Date.now() < p.finishAt)
                .map(([id]) => [0, id]),
            ],
            queue_pending: [
              ...Array.from({ length: opts.queuePending ?? 0 }, (_, i) => [
                i,
                `foreign-pending-${i}`,
              ]),
              ...[...prompts]
                .filter(([, p]) => !p.removed && Date.now() < p.startAt)
                .map(([id]) => [0, id]),
            ],
          }),
        );
        return;
      }

      if (req.method === 'GET' && url.pathname === '/prompt') {
        res.writeHead(opts.promptStatus ?? 200, { 'Content-Type': 'application/json' });
        res.end(
          opts.promptBody ??
            JSON.stringify({
              exec_info: {
                queue_remaining:
                  opts.queueRemaining ??
                  [...prompts.values()].filter((p) => !p.removed && Date.now() < p.finishAt).length,
              },
            }),
        );
        return;
      }

      if (req.method === 'POST' && url.pathname === '/prompt') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          try {
            lastPrompt = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            lastPrompt = null;
          }
          const promptId = `mock-prompt-${promptSeq++}`;
          lastPromptId = promptId;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ prompt_id: promptId }));

          const delayMs = (opts.startDelayMs ?? 0) + (opts.completionDelayMs ?? 50);
          const state = {
            startAt: Date.now() + (opts.startDelayMs ?? 0),
            finishAt: Date.now() + delayMs,
            removed: false,
          };
          prompts.set(promptId, state);
          const timer = setTimeout(() => {
            timers.delete(timer);
            if (state.removed) return;
            histories[promptId] = opts.fail
              ? {
                  status: {
                    status_str: 'error',
                    messages: [
                      [
                        'execution_error',
                        { node_type: 'MockNode', node_id: '1', exception_message: 'mock error' },
                      ],
                    ],
                  },
                }
              : {
                  outputs: {
                    '10': {
                      images: [
                        {
                          filename: opts.outputFilename ?? 'result.png',
                          subfolder: '',
                          type: 'output',
                        },
                      ],
                    },
                  },
                };
            wss.clients.forEach((ws) => {
              const event = opts.fail
                ? {
                    type: 'execution_error',
                    data: { prompt_id: promptId, exception_message: 'mock error' },
                  }
                : { type: 'execution_complete', data: { prompt_id: promptId } };
              if (ws.readyState === 1) ws.send(JSON.stringify(event));
            });
          }, delayMs);
          timers.add(timer);
        });
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/history/')) {
        const promptId = url.pathname.split('/').pop() ?? '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(histories[promptId] ? { [promptId]: histories[promptId] } : {}));
        return;
      }

      if (req.method === 'POST' && (url.pathname === '/queue' || url.pathname === '/interrupt')) {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const body = raw ? (JSON.parse(raw) as { delete?: string[]; prompt_id?: string }) : {};
          if (url.pathname === '/queue') {
            deleted.push(body.delete ?? []);
            if ((opts.deleteStatus ?? 200) === 200) {
              for (const id of body.delete ?? []) {
                const state = prompts.get(id);
                // ComfyUI 0.37.0 returns success but does nothing to a running prompt.
                if (state && Date.now() < state.startAt) state.removed = true;
              }
            }
          } else {
            interrupted.push(body.prompt_id);
            if ((opts.interruptStatus ?? 200) === 200) {
              for (const [id, state] of prompts) {
                if (
                  (!body.prompt_id || body.prompt_id === id) &&
                  !state.removed &&
                  Date.now() >= state.startAt &&
                  Date.now() < state.finishAt
                ) {
                  state.removed = true;
                  histories[id] = {
                    status: {
                      status_str: 'error',
                      messages: [['execution_interrupted', { prompt_id: id }]],
                    },
                  };
                }
              }
            }
          }
          res.writeHead(
            url.pathname === '/queue' ? (opts.deleteStatus ?? 200) : (opts.interruptStatus ?? 200),
            { 'Content-Type': 'application/json' },
          );
          res.end('{}');
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/upload/image') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          // Echo the incoming multipart field's original filename (e.g.
          // "shopify_customer_<jobId>.jpg") back into the assigned name so
          // tests can trace the returned name to its source upload instead of
          // getting an arbitrary counter-only string. `uploadSeq` is still
          // appended to preserve collision-avoidance for callers that upload
          // multiple files with the same prefix/name in one job.
          const body = Buffer.concat(chunks).toString('utf8');
          const match = body.match(/filename="([^"]*)"/);
          const originalName = match?.[1] ?? 'unknown';
          uploadedFilenames.push(originalName);
          const stem = originalName.replace(/\.[^./]+$/, '') || 'unknown';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ name: `uploaded-${stem}-${uploadSeq++}.jpg` }));
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/view') {
        // PNG magic bytes as minimal valid response
        const bytes = opts.outputBytes ?? new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(Buffer.from(bytes));
        return;
      }

      res.writeHead(404).end();
    });

    const wss = new WebSocketServer({ server });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        lastPromptId: () => lastPromptId,
        deleteCalls: () => deleted,
        interruptCalls: () => interrupted,
        lastPrompt: () => lastPrompt,
        uploadedFilenames: () => [...uploadedFilenames],
        resetPrompts: () => {
          for (const timer of timers) clearTimeout(timer);
          timers.clear();
          prompts.clear();
          for (const id of Object.keys(histories)) delete histories[id];
          deleted.length = 0;
          interrupted.length = 0;
        },
        setOptions: (newOpts) => {
          opts = newOpts;
        },
        close: () =>
          new Promise<void>((r) => {
            for (const timer of timers) clearTimeout(timer);
            wss.close();
            server.close(() => r());
          }),
      });
    });
  });
}
