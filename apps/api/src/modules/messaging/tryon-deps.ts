import { whatsappGarmentUnavailableTotal } from '@aivastra/observability';
import type { FastifyInstance } from 'fastify';
import { getTryonCreditCost } from '../../lib/resolution-config.js';
import { createEngineDeps } from './deps.js';
import type { TryonDeps } from './engine/tryon-engine.js';
import { createTryonRun, listPoolPoses } from './tryon-jobs.js';

/** Real TryonDeps. Nonce, balance, shuffle and links are the catalogue flow's own. */
export function createTryonDeps(app: FastifyInstance): TryonDeps {
  const base = createEngineDeps(app);
  return {
    newNonce: base.newNonce,
    getBalance: base.getBalance,
    shuffle: base.shuffle,
    links: base.links,
    getTryonCost: () => getTryonCreditCost(app),
    listPoolPoses: (gender) => listPoolPoses(app, gender),
    createTryonRun: (ctx, input) => createTryonRun(app, ctx, input),
    // Info, not warn: it is admin data. The label reuses the existing counter.
    reportNoPoses: (gender) => {
      whatsappGarmentUnavailableTotal.inc({ reason: 'no_poses' });
      app.log.info({ gender }, 'whatsapp: no try-on poses for gender');
    },
  };
}
