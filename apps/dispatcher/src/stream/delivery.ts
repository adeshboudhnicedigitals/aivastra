/**
 * The message id of a delivery that has no stream message behind it. The stuck-job sweeper
 * hands a job to the processor without one: XACK on this id is a no-op, and a requeue has no
 * original to hand off (it appends the replacement from the job's own fields instead).
 */
export const NO_MESSAGE_ID = '0-0';
