import type { Redis } from 'ioredis';
import { healthKey, REGISTRY_KEY } from './registry.js';

const RR_CURSOR_KEY = 'worker:rr_cursor';

// Lua script: atomically round-robin to the next IDLE+healthy worker, mark BUSY,
// return {id, url, apiKey}. Cursor advances on every claim so consecutive jobs
// fan out across workers instead of always re-claiming the first IDLE one found.
const CLAIM_LUA = `
local fields = redis.call('HGETALL', KEYS[1])
local n = #fields / 2
if n == 0 then return false end
local cursor = redis.call('INCR', KEYS[3])
local start = cursor % n
for offset = 0, n - 1 do
  local i = ((start + offset) % n) * 2 + 1
  local id = fields[i]
  local ok, val = pcall(cjson.decode, fields[i+1])
  if ok and val.status == 'IDLE' then
    if redis.call('EXISTS', KEYS[2] .. id) == 1 then
      val.status = 'BUSY'
      val.lastSeen = tonumber(ARGV[1])
      redis.call('HSET', KEYS[1], id, cjson.encode(val))
      return {id, val.url, val.apiKey}
    end
  end
end
return false
`;

export interface ClaimedWorker {
  id: string;
  url: string;
  apiKey: string;
}

export async function selectWorker(redis: Redis): Promise<ClaimedWorker | null> {
  const healthPrefix = healthKey(''); // "worker:health:"
  const result = (await redis.eval(
    CLAIM_LUA,
    3,
    REGISTRY_KEY,
    healthPrefix,
    RR_CURSOR_KEY,
    String(Date.now()),
  )) as [string, string, string] | false | null;

  if (!result) return null;
  return { id: result[0]!, url: result[1]!, apiKey: result[2]! };
}
