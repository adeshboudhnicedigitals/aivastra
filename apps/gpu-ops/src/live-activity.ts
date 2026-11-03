import { AuthError, type AuthRecovery, fetchWithRefresh } from './auth';

export type ActivitySource = 'AUDIT' | 'INCIDENT' | 'COMMAND';
export type ActivityItem = {
  id: string;
  at: string;
  source: ActivitySource;
  action: string;
  actor: string | null;
  workerId: string | null;
  summary: string;
};
export type ActivityList = { generatedAt: string; items: ActivityItem[]; hasMore: boolean };
export type ActivityFilters = {
  source?: ActivitySource[];
  workerId?: string;
  limit?: number;
  offset?: number;
};

export class FleetActivityApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const SOURCES: ActivitySource[] = ['AUDIT', 'INCIDENT', 'COMMAND'];
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isDate = (v: unknown): v is string => isStr(v) && !Number.isNaN(Date.parse(v));
const bad = (where: string): never => {
  throw new FleetActivityApiError(
    0,
    `Fleet API returned an unexpected activity response (${where}).`,
  );
};

function parseItem(value: unknown, index: number): ActivityItem {
  const at = `items[${index}]`;
  if (!isObj(value)) return bad(at);
  const { id, at: when, source, action, actor, workerId, summary } = value;
  if (!isStr(id) || !id) return bad(`${at}.id`);
  if (!isDate(when)) return bad(`${at}.at`);
  if (!SOURCES.includes(source as ActivitySource)) return bad(`${at}.source`);
  if (!isStr(action)) return bad(`${at}.action`);
  if (actor !== null && !isStr(actor)) return bad(`${at}.actor`);
  if (workerId !== null && !isStr(workerId)) return bad(`${at}.workerId`);
  if (!isStr(summary)) return bad(`${at}.summary`);
  return { id, at: when, source: source as ActivitySource, action, actor, workerId, summary };
}

export function parseActivityList(value: unknown): ActivityList {
  if (!isObj(value)) return bad('root');
  if (!isDate(value.generatedAt)) return bad('generatedAt');
  if (!Array.isArray(value.items)) return bad('items');
  if (typeof value.hasMore !== 'boolean') return bad('hasMore');
  return {
    generatedAt: value.generatedAt,
    items: value.items.map(parseItem),
    hasMore: value.hasMore,
  };
}

export function activityErrorMessage(error: unknown): string {
  if (error instanceof FleetActivityApiError && error.status === 401)
    return 'Session expired, sign in again.';
  if (error instanceof FleetActivityApiError && error.status === 403)
    return 'Your role lacks fleet.view.';
  return error instanceof Error ? error.message : 'Fleet API request failed.';
}

export async function loadActivity(
  baseUrl: string,
  token: string,
  filters: ActivityFilters = {},
  options: { recovery?: AuthRecovery; fetchImpl?: typeof fetch } = {},
): Promise<ActivityList> {
  const params = new URLSearchParams();
  if (filters.source?.length) params.set('source', filters.source.join(','));
  if (filters.workerId) params.set('workerId', filters.workerId);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset) params.set('offset', String(filters.offset));
  const query = params.toString();
  const fetchImpl = options.fetchImpl ?? fetch;
  const send = (accessToken: string) =>
    fetchImpl(`${baseUrl.replace(/\/$/, '')}/admin/fleet/activity${query ? `?${query}` : ''}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
  let response: Response;
  try {
    response = options.recovery
      ? await fetchWithRefresh(send, token, options.recovery)
      : await send(token);
  } catch (cause) {
    if (cause instanceof AuthError) throw new FleetActivityApiError(401, cause.message);
    throw new FleetActivityApiError(0, 'Fleet API unavailable.');
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new FleetActivityApiError(
      response.status,
      isObj(payload) && isObj(payload.error) && isStr(payload.error.message)
        ? payload.error.message
        : `Fleet API returned ${response.status}.`,
    );
  }
  return parseActivityList(await response.json().catch(() => null));
}
