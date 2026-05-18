import type { FastifyRequest, FastifyReply } from 'fastify';
import { Redis } from 'ioredis';

export async function sseHandler(this: any, req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const userId = (req as any).userId;
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sub: Redis = (req.server as any).redisSub.duplicate();
  const channel = `sse:events:${userId}`;
  await sub.subscribe(channel);
  sub.on('message', (_ch, raw) => {
    try {
      const evt = JSON.parse(raw);
      if (evt.jobId !== id) return;
      reply.raw.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
    } catch { /* ignore */ }
  });

  const heartbeat = setInterval(() => reply.raw.write(`: ping\n\n`), 15_000);

  req.raw.on('close', async () => {
    clearInterval(heartbeat);
    await sub.unsubscribe(channel); sub.disconnect();
  });
}
