import { hostname } from 'node:os';
import type { Redis } from 'ioredis';
import { NO_MESSAGE_ID } from './delivery.js';

const GROUP = 'dispatcher-cg';
const CONSUMER = hostname();

// Append the replacement and ACK the original in one script, so a crash can no longer land
// between the two (an XADD without the ACK duplicates the job; an ACK without the XADD loses
// it). The original must still be pending under the caller (the GPU, video or inhouse consumer of this host): a message recovery already moved to
// another consumer, or one already handed off (a retry after a lost reply), is left alone, so
// repeating a successful call appends nothing. The replacement keeps every original field;
// only the named overrides change. Redis does not roll a script back, so a partial failure can
// still leave the original pending (recoverable) or, at worst, both (acquisition stops a double
// dispatch); it can never leave neither.
const HANDOFF_LUA = `
local pending = redis.call('XPENDING', KEYS[1], ARGV[1], ARGV[2], ARGV[2], 1)
if #pending == 0 then return 'gone' end
local owner = pending[1][2]
if owner ~= ARGV[3] and owner ~= ARGV[3] .. '-video' and owner ~= ARGV[3] .. '-inhouse' then
  return 'not_owner'
end
local entry = redis.call('XRANGE', KEYS[1], ARGV[2], ARGV[2])
if #entry == 0 then return 'gone' end
local fields = entry[1][2]
local overrides = {}
local order = {}
for i = 5, #ARGV, 2 do
  overrides[ARGV[i]] = ARGV[i + 1]
  order[#order + 1] = ARGV[i]
end
local out = {}
local seen = {}
for i = 1, #fields, 2 do
  local k = fields[i]
  out[#out + 1] = k
  if overrides[k] ~= nil then
    out[#out + 1] = overrides[k]
    seen[k] = true
  else
    out[#out + 1] = fields[i + 1]
  end
end
for _, k in ipairs(order) do
  if not seen[k] then
    out[#out + 1] = k
    out[#out + 1] = overrides[k]
  end
end
redis.call('XADD', KEYS[2], 'MAXLEN', '~', tonumber(ARGV[4]), '*', unpack(out))
redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])
return 'handed_off'
`;

export type HandoffResult = 'handed_off' | 'gone' | 'not_owner';

export async function handoffMessage(
  redis: Redis,
  args: {
    sourceStream: string;
    targetStream: string;
    messageId: string;
    /** Fields that replace (or are added to) the original's. */
    overrides?: Record<string, string>;
    consumer?: string;
    /**
     * The message the job arrived as, for a delivery with no stream message (the sweeper's):
     * there is no original to read, ACK or check, so the replacement is appended from these
     * fields alone. Ignored for a real message id.
     */
    fields?: Record<string, string>;
  },
): Promise<HandoffResult> {
  if (args.messageId === NO_MESSAGE_ID) {
    if (!args.fields) return 'gone';
    const merged = { ...args.fields, ...args.overrides };
    await redis.xadd(
      args.targetStream,
      'MAXLEN',
      '~',
      10_000,
      '*',
      ...Object.entries(merged).flat(),
    );
    return 'handed_off';
  }
  const overrides = Object.entries(args.overrides ?? {}).flat();
  const run = () =>
    redis.eval(
      HANDOFF_LUA,
      2,
      args.sourceStream,
      args.targetStream,
      GROUP,
      args.messageId,
      args.consumer ?? CONSUMER,
      '10000',
      ...overrides,
    ) as Promise<HandoffResult>;
  const settle = (err: unknown): HandoffResult => {
    // No consumer group means the original is not pending anywhere: nothing to hand off.
    if (err instanceof Error && err.message.includes('NOGROUP')) return 'gone';
    throw err;
  };
  try {
    return await run().catch(settle);
  } catch {
    // A lost reply is indistinguishable from a lost request; the script is idempotent, so a
    // repeat either completes the handoff or reports it already done.
    return run().catch(settle);
  }
}
