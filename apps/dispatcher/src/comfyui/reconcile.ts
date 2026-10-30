/**
 * Read-only discovery of a prompt on a worker: by the client id we persisted before the POST
 * (when the reply was lost) or by a prompt id we already hold. It never POSTs, never deletes
 * and never interrupts.
 *
 * Shapes parsed (ComfyUI `server.py`; field names and structure only):
 *  - GET /queue -> { queue_running: Entry[], queue_pending: Entry[] }
 *    Entry = [number, prompt_id: string, prompt: object, extra_data: object, outputs_to_execute]
 *    The client id is `extra_data.client_id`.
 *  - GET /history?max_items=N -> { [prompt_id]: { prompt: Entry, outputs: object,
 *    status: { status_str: 'success' | 'error', completed: boolean, messages: [...] } } }
 *    The client id is `prompt[3].client_id`.
 *
 *  - GET /history/{prompt_id} -> { [prompt_id]: <same entry> } or {} when the worker has no
 *    record of it. Used when the prompt id is already held: one small read instead of a page.
 *
 * Anything that does not parse into exactly that is "unavailable", never "absent": absence is
 * only claimed from a fully parsed queue followed by a fully parsed history (a full page by
 * client id is never absence). A history entry with no verdict is skipped, not fatal.
 */

/** The slice of a pino logger this module needs; skipped history entries are counted there. */
export interface SkipLog {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export type PromptObservation = 'queued' | 'running' | 'succeeded' | 'failed';

export interface FoundReceipt {
  kind: 'found';
  promptId: string;
  observation: PromptObservation;
}
/** No entry matched, after a complete queue read and a complete history read made after it. */
export interface NotFound {
  kind: 'not_found';
}
/** A read failed, was malformed or truncated, or matched ambiguously. Never evidence of absence. */
export interface Unavailable {
  kind: 'unavailable';
  reason: string;
}
export type PromptSearchResult = FoundReceipt | NotFound | Unavailable;

export interface ReconcileWorker {
  url: string;
  apiKey: string;
}

// A page of exactly this many history entries may have been cut off by the worker, so a miss in
// it is not absence. ComfyUI honours `max_items` and returns the newest entries.
export const HISTORY_PAGE_LIMIT = 500;
const READ_TIMEOUT_MS = 10_000;
// The full history page (500 entries with their workflows) is megabytes on a busy worker and
// regularly outruns the 10 s cap that suits the small reads.
const HISTORY_PAGE_TIMEOUT_MS = 30_000;

type QueueEntry = { promptId: string; clientId: string | null };
type HistoryEntry = QueueEntry & { observation: 'succeeded' | 'failed' };
/** An entry with no success/error verdict: seen, but never classified. */
type SkippedEntry = QueueEntry;

class Unparseable extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseEntry(raw: unknown): QueueEntry {
  if (!Array.isArray(raw) || typeof raw[1] !== 'string' || !isRecord(raw[3]))
    throw new Unparseable('queue entry shape');
  const clientId = raw[3].client_id;
  return { promptId: raw[1], clientId: typeof clientId === 'string' ? clientId : null };
}

async function readJson(
  worker: ReconcileWorker,
  path: string,
  deadline: Date | undefined,
  capMs = READ_TIMEOUT_MS,
): Promise<unknown> {
  // Never wait past the persisted deadline's own tick: the cap (10 s for the small reads) is
  // the ceiling, shorter when the caller is already late so one slow worker cannot stall the
  // whole batch.
  const remaining = deadline ? deadline.getTime() - Date.now() : capMs;
  const timeoutMs = Math.min(capMs, Math.max(2_000, remaining));
  const res = await fetch(`${worker.url.replace(/\/$/, '')}${path}`, {
    headers: { 'X-Api-Key': worker.apiKey },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Unparseable(`${path} status ${res.status}`);
  return res.json();
}

async function readQueue(
  worker: ReconcileWorker,
  deadline: Date | undefined,
): Promise<{ running: QueueEntry[]; pending: QueueEntry[] }> {
  const body = await readJson(worker, '/queue', deadline);
  if (!isRecord(body) || !Array.isArray(body.queue_running) || !Array.isArray(body.queue_pending))
    throw new Unparseable('queue lists');
  return {
    running: body.queue_running.map(parseEntry),
    pending: body.queue_pending.map(parseEntry),
  };
}

function verdictOf(entry: Record<string, unknown>): unknown {
  return isRecord(entry.status) ? entry.status.status_str : undefined;
}

async function readHistory(
  worker: ReconcileWorker,
  deadline: Date | undefined,
  log?: SkipLog,
): Promise<{ entries: HistoryEntry[]; skipped: SkippedEntry[] }> {
  const body = await readJson(
    worker,
    `/history?max_items=${HISTORY_PAGE_LIMIT}`,
    deadline,
    HISTORY_PAGE_TIMEOUT_MS,
  );
  if (!isRecord(body)) throw new Unparseable('history object');
  const entries: HistoryEntry[] = [];
  const skipped: SkippedEntry[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (!isRecord(value)) throw new Unparseable('history entry');
    const base = parseEntry(value.prompt);
    if (base.promptId !== key) throw new Unparseable('history key mismatch');
    const status = verdictOf(value);
    // A history row exists only once the prompt ran to an end. One without an explicit verdict
    // is never classified as success or failure, but it must not make every other prompt on
    // the worker unreadable: it is skipped and counted, and only blocks a search for itself.
    if (status !== 'success' && status !== 'error') {
      skipped.push(base);
      continue;
    }
    entries.push({ ...base, observation: status === 'success' ? 'succeeded' : 'failed' });
  }
  if (skipped.length > 0)
    log?.warn(
      { stage: 'reservation_reconcile', skippedHistoryEntries: skipped.length },
      'history entries without a success/error verdict were skipped',
    );
  return { entries, skipped };
}

function failure(err: unknown): Unavailable {
  return {
    kind: 'unavailable',
    reason: err instanceof Unparseable ? `malformed: ${err.message}` : 'unreachable',
  };
}

/**
 * Finds the prompt a worker accepted for `clientId`. Order matters: queue first, then history,
 * so a prompt that moves from the queue to history between the two reads is seen in one of them.
 */
export async function findPromptByClientId(
  worker: ReconcileWorker,
  clientId: string,
  deadline?: Date,
  log?: SkipLog,
): Promise<PromptSearchResult> {
  try {
    const queue = await readQueue(worker, deadline);
    const running = queue.running.filter((e) => e.clientId === clientId);
    const pending = queue.pending.filter((e) => e.clientId === clientId);
    if (running.length + pending.length > 1)
      return {
        kind: 'unavailable',
        reason: 'ambiguous: several queue entries share the client id',
      };
    if (running[0]) return { kind: 'found', promptId: running[0].promptId, observation: 'running' };
    if (pending[0]) return { kind: 'found', promptId: pending[0].promptId, observation: 'queued' };

    const history = await readHistory(worker, deadline, log);
    if (history.skipped.some((e) => e.clientId === clientId))
      return { kind: 'unavailable', reason: 'history entry for this client has no verdict' };
    const done = history.entries.filter((e) => e.clientId === clientId);
    if (done.length > 1)
      return {
        kind: 'unavailable',
        reason: 'ambiguous: several history entries share the client id',
      };
    if (done[0])
      return { kind: 'found', promptId: done[0].promptId, observation: done[0].observation };
    // A page of exactly the limit may have been cut off by the worker; a miss in it is not
    // absence.
    if (history.entries.length + history.skipped.length >= HISTORY_PAGE_LIMIT)
      return { kind: 'unavailable', reason: 'history page may be truncated' };
    return { kind: 'not_found' };
  } catch (err) {
    return failure(err);
  }
}

/**
 * The same observation for a prompt id we already hold. `not_found` here means the prompt is not
 * in the queue and the worker has no history record of it, i.e. it cannot still be executing.
 * The history read is by id, so a worker with a long history cannot push the entry out of view.
 */
export async function findPromptById(
  worker: ReconcileWorker,
  promptId: string,
  deadline?: Date,
  log?: SkipLog,
): Promise<PromptSearchResult> {
  try {
    const queue = await readQueue(worker, deadline);
    if (queue.running.some((e) => e.promptId === promptId))
      return { kind: 'found', promptId, observation: 'running' };
    if (queue.pending.some((e) => e.promptId === promptId))
      return { kind: 'found', promptId, observation: 'queued' };
    // Read after the queue, same ordering argument as findPromptByClientId.
    const body = await readJson(worker, `/history/${encodeURIComponent(promptId)}`, deadline);
    if (!isRecord(body)) throw new Unparseable('history object');
    const keys = Object.keys(body);
    if (keys.length === 0) return { kind: 'not_found' };
    const entry = body[promptId];
    if (keys.length !== 1 || !isRecord(entry)) throw new Unparseable('history key mismatch');
    const status = verdictOf(entry);
    if (status !== 'success' && status !== 'error') {
      log?.warn(
        { stage: 'reservation_reconcile', promptId },
        'history entry without a success/error verdict',
      );
      return { kind: 'unavailable', reason: 'history entry for this prompt has no verdict' };
    }
    return { kind: 'found', promptId, observation: status === 'success' ? 'succeeded' : 'failed' };
  } catch (err) {
    return failure(err);
  }
}
