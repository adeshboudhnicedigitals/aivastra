import { createServer } from 'node:http';
import type { Logger } from '@aivastra/logger';

export function startHealthServer(port: number, log: Logger): () => void {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(404).end();
    }
  });

  server.listen(port, '127.0.0.1', () => {
    log.info({ port }, 'health server listening');
  });

  return () => server.close();
}
