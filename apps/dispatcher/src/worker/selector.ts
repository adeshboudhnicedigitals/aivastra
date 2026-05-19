import type { Redis } from 'ioredis';
import { REGISTRY_KEY, healthKey } from './registry.js';

// Lua script: atomically find first IDLE+healthy worker, mark BUSY, return {id, url}
const CLAIM_LUA = `
local fields = redis.call('HGETALL', KEYS[1])
for i = 1, #fields, 2 do
  local id = fields[i]
  local ok, val = pcall(cjson.decode, fields[i+1])
  if ok and val.status == 'IDLE' then
    if redis.call('EXISTS', KEYS[2] .. id) == 1 then
      val.status = 'BUSY'
      val.lastSeen = tonumber(ARGV[1])
      redis.call('HSET', KEYS[1], id, cjson.encode(val))
      return {id, val.url}
    end
  end
end
return false
`;

export interface ClaimedWorker {
  id: string;
  url: string;
}

export async function selectWorker(redis: Redis): Promise<ClaimedWorker | null> {
  const healthPrefix = healthKey(''); // "worker:health:"
  const result = await redis.eval(
    CLAIM_LUA,
    2,
    REGISTRY_KEY,
    healthPrefix,
    String(Date.now()),
  ) as [string, string] | false | null;

  if (!result || result === false) return null;
  return { id: result[0]!, url: result[1]! };
}
