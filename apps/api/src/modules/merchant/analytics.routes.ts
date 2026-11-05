import { MerchantAnalyticsQuery } from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { merchantAnalytics } from './analytics.js';

export async function merchantAnalyticsRoutes(app: FastifyInstance) {
  app.get(
    '/v1/merchant/analytics',
    { preHandler: app.requireMerchant, schema: { querystring: MerchantAnalyticsQuery } },
    async (req) => {
      const merchantId = req.merchantClientId;
      if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');
      const { range } = req.query as MerchantAnalyticsQuery;
      return merchantAnalytics(app.db, merchantId, range, new Date());
    },
  );
}
