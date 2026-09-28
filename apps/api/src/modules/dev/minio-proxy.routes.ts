import type { FastifyInstance } from 'fastify';

/**
 * Dev-only passthrough for local MinIO, mounted at /minio/*. Presigned thumbnail
 * URLs are normally an S3-compatible endpoint the browser fetches directly, but
 * in local dev that endpoint is http://127.0.0.1:9000 while the Shopify admin
 * SPA loads from an https ngrok origin — Chrome's Private Network Access policy
 * blocks a public-origin page from fetching a bare loopback address outright
 * (net::ERR_FAILED, "Permission was denied for this request to access the
 * `loopback` address space"), so every product thumbnail came back blank.
 *
 * Routing presigned URLs through this same-origin (tunnelled) route instead
 * mirrors how production already reaches self-hosted MinIO — behind
 * app.aivastra.com/minio/, never a bare loopback address — so R2_PUBLIC_PRESIGN_BASE
 * just needs to point at the API's own public URL in dev. See docs/progress.md.
 *
 * Registered only when NODE_ENV === 'development' (server.ts): staging and
 * production already proxy MinIO at the Nginx/CloudPanel layer and must never
 * route storage traffic through the API process instead.
 */
export async function minioProxyRoutes(app: FastifyInstance) {
  app.get('/minio/*', { schema: { hide: true } }, async (req, reply) => {
    const target = new URL(req.url, app.env.R2_ENDPOINT);
    target.pathname = target.pathname.replace(/^\/minio/, '');

    let upstream: Response;
    try {
      upstream = await fetch(target);
    } catch (err) {
      app.log.warn({ err, target: target.toString() }, 'dev minio proxy: upstream unreachable');
      return reply.code(502).send({ error: { code: 'BAD_GATEWAY', message: 'minio unreachable' } });
    }

    reply.code(upstream.status);
    // content-length is recomputed by Fastify from the piped body; forwarding the
    // upstream's stale value alongside a chunked transfer would conflict.
    for (const [key, value] of upstream.headers) {
      if (key === 'content-length' || key === 'transfer-encoding') continue;
      reply.header(key, value);
    }
    return reply.send(upstream.body);
  });
}
