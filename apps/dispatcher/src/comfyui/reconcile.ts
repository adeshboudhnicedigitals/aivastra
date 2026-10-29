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
 * Anything that does not parse into exactly that is "unavailable", never "absent": absence is
 * only claimed from a fully parsed queue followed by a fully parsed, untruncated history.
 */

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

type QueueEntry = { promptId: string; clientId: string | null };
type HistoryEntry = QueueEntry & { observation: 'succeeded' | 'failed' };

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
): Promise<unknown> {
  // Never wait past the persisted deadline's own tick: a 10 s read is the cap, shorter when the
  // caller is already late so one slow worker cannot stall the whole batch.
  const remaining = deadline ? deadline.getTime() - Date.now() : READ_TIMEOUT_MS;
  const timeoutMs = Math.min(READ_TIMEOUT_MS, Math.max(2_000, remaining));
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

async function readHistory(
  worker: ReconcileWorker,
  deadline: Date | undefined,
): Promise<{ entries: HistoryEntry[]; truncated: boolean }> {
  const body = await readJson(worker, `/history?max_items=${HISTORY_PAGE_LIMIT}`, deadline);
  if (!isRecord(body)) throw new Unparseable('history object');
  const entries: HistoryEntry[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (!isRecord(value)) throw new Unparseable('history entry');
    const base = parseEntry(value.prompt);
    if (base.promptId !== key) throw new Unparseable('history key mismatch');
    const status = isRecord(value.status) ? value.status.status_str : undefined;
    // A history row exists only once the prompt ran to an end. Anything without an explicit
    // verdict is not classified as success or failure.
    if (status !== 'success' && status !== 'error') throw new Unparseable('history status');
    entries.push({ ...base, observation: status === 'success' ? 'succeeded' : 'failed' });
  }
  return { entries, truncated: entries.length >= HISTORY_PAGE_LIMIT };
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

    const history = await readHistory(worker, deadline);
    const done = history.entries.filter((e) => e.clientId === clientId);
    if (done.length > 1)
      return {
        kind: 'unavailable',
        reason: 'ambiguous: several history entries share the client id',
      };
    if (done[0])
      return { kind: 'found', promptId: done[0].promptId, observation: done[0].observation };
    if (history.truncated) return { kind: 'unavailable', reason: 'history page may be truncated' };
    return { kind: 'not_found' };
  } catch (err) {
    return failure(err);
  }
}

/**
 * The same observation for a prompt id we already hold. `not_found` here means the prompt is in
 * neither the queue nor the (untruncated) history, i.e. it cannot still be executing.
 */
export async function findPromptById(
  worker: ReconcileWorker,
  promptId: string,
  deadline?: Date,
): Promise<PromptSearchResult> {
  try {
    const queue = await readQueue(worker, deadline);
    if (queue.running.some((e) => e.promptId === promptId))
      return { kind: 'found', promptId, observation: 'running' };
    if (queue.pending.some((e) => e.promptId === promptId))
      return { kind: 'found', promptId, observation: 'queued' };
    const history = await readHistory(worker, deadline);
    const done = history.entries.find((e) => e.promptId === promptId);
    if (done) return { kind: 'found', promptId, observation: done.observation };
    if (history.truncated) return { kind: 'unavailable', reason: 'history page may be truncated' };
    return { kind: 'not_found' };
  } catch (err) {
    return failure(err);
  }
}
