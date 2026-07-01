import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';

export interface ComfyMockOptions {
  fail?: boolean;
  completionDelayMs?: number;
  outputFilename?: string;
  outputBytes?: Uint8Array;
}

export interface ComfyMock {
  url: string;
  lastPromptId: () => string | null;
  setOptions: (opts: ComfyMockOptions) => void;
  close: () => Promise<void>;
}

export function startComfyMock(): Promise<ComfyMock> {
  return new Promise((resolve) => {
    let opts: ComfyMockOptions = {};
    let lastPromptId: string | null = null;

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/system_stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ system: { python_version: '3.10' } }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/prompt') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          const { prompt_id: _, client_id } = JSON.parse(body) as {
            prompt_id?: string;
            client_id: string;
          };
          const promptId = `mock-prompt-${Date.now()}`;
          lastPromptId = promptId;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ prompt_id: promptId }));

          const delayMs = opts.completionDelayMs ?? 50;
          setTimeout(() => {
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
        });
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/history/')) {
        const filename = opts.outputFilename ?? 'result.png';
        const promptId = url.pathname.split('/').pop() ?? '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            [promptId]: {
              outputs: { '10': { images: [{ filename, subfolder: '', type: 'output' }] } },
            },
          }),
        );
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

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        lastPromptId: () => lastPromptId,
        setOptions: (newOpts) => {
          opts = newOpts;
        },
        close: () =>
          new Promise<void>((r) => {
            wss.close();
            server.close(() => r());
          }),
      });
    });
  });
}
