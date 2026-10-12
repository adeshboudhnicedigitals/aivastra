import {
  DEFAULT_REFUND_AUTO_APPROVE_CONFIG,
  fillRefundAutoApproveDefaults,
  type RefundAutoApproveConfig,
} from '@aivastra/types';
import type { FastifyInstance } from 'fastify';

const CONFIG_KEY = 'config:refund-auto-approve';

/**
 * Reads the admin-configured refund auto-approve setting from Redis,
 * mirroring getMaxBatchJobs() in batch-config.ts. Fail-safe: any throw
 * (Redis down, bad JSON) returns the defaults (manual approval).
 */
export async function getRefundAutoApproveConfig(
  app: FastifyInstance,
): Promise<RefundAutoApproveConfig> {
  try {
    const raw = await app.redis.get(CONFIG_KEY);
    const stored = raw ? JSON.parse(raw) : {};
    return fillRefundAutoApproveDefaults(stored);
  } catch {
    return { ...DEFAULT_REFUND_AUTO_APPROVE_CONFIG };
  }
}
