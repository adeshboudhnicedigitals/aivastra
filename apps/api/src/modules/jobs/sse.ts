import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';

function writeSseHeaders(reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

function makeSubscription(
  req: FastifyRequest,
  reply: FastifyReply,
  channel: string,
  filter?: (evt: Record<string, unknown>) => boolean,
): void {
  const sub: Redis = (req.server as any).redisSub.duplicate();

  sub.subscribe(channel).then(() => {
    sub.on('message', (_ch, raw) => {
      try {
        const evt = JSON.parse(raw) as Record<string, unknown>;
        if (filter && !filter(evt)) return;
        reply.raw.write(`event: ${evt.type ?? 'message'}\ndata: ${raw}\n\n`);
      } catch {
        /* ignore malformed publish */
      }
    });
  });

  const heartbeat = setInterval(() => reply.raw.write(`: ping\n\n`), 15_000);

  req.raw.on('close', async () => {
    clearInterval(heartbeat);
    await sub.unsubscribe(channel);
    sub.disconnect();
  });
}

/** Per-job SSE — kept for backward compatibility. */
export async function sseHandler(this: unknown, req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const userId = (req as any).userId;
  writeSseHeaders(reply);
  makeSubscription(req, reply, `sse:events:${userId}`, (evt) => evt.jobId === id);
}

/** User-level stream — all job events for the authenticated user, no jobId filter. */
export async function userStreamHandler(this: unknown, req: FastifyRequest, reply: FastifyReply) {
  const userId = (req as any).userId;
  writeSseHeaders(reply);
  makeSubscription(req, reply, `sse:events:${userId}`);
}

/** Admin-level stream — all job events across all users. */
export async function adminStreamHandler(this: unknown, req: FastifyRequest, reply: FastifyReply) {
  writeSseHeaders(reply);
  makeSubscription(req, reply, 'sse:events:admin');
}
