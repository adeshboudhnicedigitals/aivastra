import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Single Prometheus registry shared across a process. Both `api` and `dispatcher`
 * import this module; each only writes the metrics it owns, but all metric names are
 * defined here so the package is the single source of truth. Unused metrics simply
 * stay at zero / emit no series until first observed.
 *
 * Default Node/process metrics (event-loop lag, heap, GC, CPU) are collected on import.
 */
export const register = new Registry();

collectDefaultMetrics({ register });

// ── API metrics ─────────────────────────────────────────────────────────────

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const jobsCreatedTotal = new Counter({
  name: 'jobs_created_total',
  help: 'Jobs enqueued by the API',
  labelNames: ['priority', 'kind'] as const,
  registers: [register],
});

export const creditsDeductedTotal = new Counter({
  name: 'credits_deducted_total',
  help: 'Total credits deducted from users',
  registers: [register],
});

export const creditsRefundedTotal = new Counter({
  name: 'credits_refunded_total',
  help: 'Total credits refunded to users',
  registers: [register],
});

export const auditLogWriteFailuresTotal = new Counter({
  name: 'audit_log_write_failures_total',
  help: 'Count of failed audit log write attempts inside admin mutation transactions',
  registers: [register],
});

// ── Dispatcher metrics ───────────────────────────────────────────────────────

export const jobsProcessedTotal = new Counter({
  name: 'jobs_processed_total',
  help: 'Jobs processed by the dispatcher, by terminal outcome',
  labelNames: ['outcome'] as const, // success | failed | retried | cancelled
  registers: [register],
});

export const jobProcessingDuration = new Histogram({
  name: 'job_processing_duration_seconds',
  help: 'End-to-end job processing duration in the dispatcher',
  labelNames: ['outcome', 'job_type'] as const, // job_type mirrors jobs.source (JOB_SOURCE)
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [register],
});

export const jobAttemptsTotal = new Counter({
  name: 'job_attempts_total',
  help: 'Job processing attempts (incremented once per attempt)',
  registers: [register],
});

export const jobE2eDuration = new Histogram({
  name: 'job_e2e_duration_seconds',
  help: 'Wall-clock time from job creation to terminal status (includes queue wait)',
  labelNames: ['outcome', 'job_type'] as const, // outcome: completed | failed | cancelled; job_type mirrors jobs.source
  buckets: [5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600],
  registers: [register],
});

export const comfyRequestDuration = new Histogram({
  name: 'comfy_request_duration_seconds',
  help: 'Duration of the ComfyUI /prompt round-trip',
  labelNames: ['job_type'] as const, // mirrors jobs.source (JOB_SOURCE)
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [register],
});

export const queueDepth = new Gauge({
  name: 'queue_depth',
  help: 'Number of pending messages in a Redis job stream',
  labelNames: ['stream'] as const,
  registers: [register],
});

export const workersHealthy = new Gauge({
  name: 'workers_healthy',
  help: 'Count of GPU workers currently reporting healthy',
  registers: [register],
});

export const comfyWorkerQueueRemaining = new Gauge({
  name: 'comfy_worker_queue_remaining',
  help: "Running + pending prompts in a worker's ComfyUI /queue at the last health-monitor sample (includes our own job)",
  labelNames: ['worker_id'] as const,
  registers: [register],
});

export const comfyWorkerExternalBusy = new Gauge({
  name: 'comfy_worker_external_busy',
  help: 'Worker is IDLE in our registry but its ComfyUI queue is non-empty (work submitted outside the dispatcher): 1/0',
  labelNames: ['worker_id'] as const,
  registers: [register],
});

export const comfyWorkerQueueProbesTotal = new Counter({
  name: 'comfy_worker_queue_probes_total',
  help: 'ComfyUI /queue probes by the health monitor',
  labelNames: ['result'] as const, // ok | error
  registers: [register],
});

export const comfyWorkerQueueProbeDuration = new Histogram({
  name: 'comfy_worker_queue_probe_duration_seconds',
  help: 'Duration of the health monitor /queue probe',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 3],
  registers: [register],
});

export const noWorkerRequeuesTotal = new Counter({
  name: 'dispatcher_no_worker_requeues_total',
  help: 'Jobs re-enqueued because no eligible worker was free (capacity, not failure — attempts untouched)',
  labelNames: ['job_type'] as const, // mirrors jobs.source (JOB_SOURCE)
  registers: [register],
});

export const workerExternalBusyRejectionsTotal = new Counter({
  name: 'dispatcher_worker_external_busy_rejections_total',
  help: 'Workers skipped at claim time because ComfyUI itself reported a non-empty queue, or the queue probe failed (fail-closed)',
  labelNames: ['reason'] as const,
  registers: [register],
});

export const workerReleaseFailuresTotal = new Counter({
  name: 'dispatcher_worker_release_failures_total',
  help: 'Count of failed attempts to release a claimed-but-unused worker back to IDLE (lost capacity until restart)',
  registers: [register],
});

// ── Chatbot metrics ──────────────────────────────────────────────────────────

export const chatbotMessagesTotal = new Counter({
  name: 'chatbot_messages_total',
  help: 'Chat messages persisted, by role',
  labelNames: ['role'] as const,
  registers: [register],
});

export const chatbotEscalationsTotal = new Counter({
  name: 'chatbot_escalations_total',
  help: 'Conversations escalated to a human, by reason',
  labelNames: ['reason'] as const,
  registers: [register],
});

export const chatbotFallbacksTotal = new Counter({
  name: 'chatbot_fallbacks_total',
  help: 'Bot low-confidence fallback replies',
  registers: [register],
});

export const chatbotBotTurnDuration = new Histogram({
  name: 'chatbot_bot_turn_duration_seconds',
  help: 'Bot turn latency (retrieval + tools + generation)',
  buckets: [0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

export const chatbotActiveSockets = new Gauge({
  name: 'chatbot_active_sockets',
  help: 'Open chatbot websockets',
  labelNames: ['kind'] as const,
  registers: [register],
});

// ── Exposition ───────────────────────────────────────────────────────────────

/** Prometheus text exposition for the `/metrics` endpoint. */
export function metricsText(): Promise<string> {
  return register.metrics();
}

export const metricsContentType = register.contentType;

export const comfyPromptQueueWait = new Histogram({
  name: 'comfy_prompt_queue_wait_seconds',
  help: 'Submission to first observed execution',
  labelNames: ['workerId'] as const,
  buckets: [1, 3, 10, 30, 60, 180, 300, 600, 900],
  registers: [register],
});
export const comfyQueueCleanupFailed = new Counter({
  name: 'comfy_queue_cleanup_failed_total',
  help: 'Queue budget exhausted with an orphaned prompt',
  labelNames: ['workerId'] as const,
  registers: [register],
});
export const comfyLegacyFallback = new Counter({
  name: 'comfy_legacy_fallback_total',
  help: 'Submission based timeout mode entries',
  labelNames: ['workerId', 'entry'] as const,
  registers: [register],
});
export const comfyCapabilityUnreadable = new Counter({
  name: 'comfy_capability_read_unreadable_total',
  help: 'Capability state unavailable or malformed',
  labelNames: ['workerId', 'context'] as const,
  registers: [register],
});
export const comfyVersionMismatch = new Counter({
  name: 'comfy_version_guard_mismatches_total',
  help: 'Validated worker version missing or different',
  labelNames: ['workerId'] as const,
  registers: [register],
});
export const comfyGateDrift = new Counter({
  name: 'comfy_capability_gate_drift_total',
  help: 'Configured worker without queue gate protection',
  labelNames: ['workerId'] as const,
  registers: [register],
});
export const comfyConfigLoss = new Counter({
  name: 'comfy_cancel_config_loss_total',
  help: 'Cancellation ratchet prevents legacy after configuration loss',
  labelNames: ['workerId'] as const,
  registers: [register],
});
export const comfyDestructiveSkipped = new Counter({
  name: 'comfy_destructive_calls_skipped_total',
  help: 'Destructive call denied by live authorization',
  labelNames: ['workerId', 'operation'] as const,
  registers: [register],
});
export const comfyCancelTotal = new Counter({
  name: 'comfy_cancels_total',
  help: 'Cancellation modes and confirmation outcomes',
  labelNames: ['workerId', 'mode', 'outcome'] as const,
  registers: [register],
});
export const comfyDeleteFailures = new Counter({
  name: 'comfy_delete_failures_total',
  help: 'Scoped cancellation delete failures',
  labelNames: ['workerId'] as const,
  registers: [register],
});

export const perfSamples = new Counter({
  name: 'dispatcher_perf_samples_total',
  help: 'Performance samples accepted or skipped',
  labelNames: ['outcome', 'reason'] as const,
  registers: [register],
});
export const perfCachedSkips = new Counter({
  name: 'dispatcher_perf_cached_skips_total',
  help: 'Cached performance samples excluded from EWMA',
  registers: [register],
});
export const perfProbeBackoff = new Counter({
  name: 'dispatcher_perf_probe_backoff_total',
  help: 'ACTIVE probe backoff events',
  labelNames: ['pool'] as const,
  registers: [register],
});
export const perfSelectionMode = new Counter({
  name: 'dispatcher_perf_selections_total',
  help: 'Worker claims by routing mode',
  labelNames: ['mode', 'pool'] as const,
  registers: [register],
});
