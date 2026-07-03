import { type DB, schema, sql } from '@aivastra/db';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { Env } from './env.js';
import { AppError } from './lib/errors.js';
import { conversationRoutes } from './routes/conversations.js';
import { ingestRoutes } from './routes/ingest.js';

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export interface ChatbotDeps {
  env: Env;
  db: DB;
  redis: Redis;
  pub: Redis;
  sub: Redis;
  embed: EmbedFn;
  log: FastifyBaseLogger;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: ChatbotDeps;
  }
}

export async function buildChatbotServer(deps: ChatbotDeps): Promise<FastifyInstance> {
  const app = Fastify({ loggerInstance: deps.log });
  app.decorate('deps', deps);
  await app.register(websocket);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    app.log.error({ err, url: req.url }, 'unhandled');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'internal error' } });
  });

  app.get('/health', async () => {
    const [qna] = await deps.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.chatbotQna)
      .where(sql`${schema.chatbotQna.isActive} = true`);
    const [emb] = await deps.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.chatbotEmbeddings);
    return { ok: true, qna: qna?.n ?? 0, embedded: emb?.n ?? 0 };
  });

  await app.register(ingestRoutes);
  await app.register(conversationRoutes);

  return app;
}

export function requireServiceToken(env: Env) {
  return async (req: { headers: Record<string, unknown> }) => {
    if (req.headers['x-service-token'] !== env.CHATBOT_SERVICE_TOKEN)
      throw new AppError('UNAUTH', 401, 'bad service token');
  };
}
