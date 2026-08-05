/**
 * Shared constants to avoid circular dependencies
 */

/**
 * Controls whether stack traces are stored in error objects
 * TODO: Accept this as configuration parameter in the future
 */
export const STORE_STACK_TRACES = false;

/**
 * Checkpoint manager termination cooldown in milliseconds
 * After the last operation completes, the checkpoint manager waits this duration
 * before terminating to allow for any final checkpoint operations
 */
export const CHECKPOINT_TERMINATION_COOLDOWN_MS = 20;

/**
 * Maximum delay accepted by setTimeout (2^31 - 1 milliseconds, ~24.8 days).
 * Node.js clamps larger delays to 1ms, which would make a far-future timer
 * fire immediately. Timers for operations due beyond this bound are not
 * scheduled; those operations resume via suspension and re-invocation instead.
 */
export const MAX_SET_TIMEOUT_DELAY_MS = 2 ** 31 - 1;

/**
 * Maximum checkpoint payload size in bytes (256KB).
 * Payloads exceeding this limit trigger ReplayChildren mode in child contexts,
 * and overflow-to-file behavior in FileSystemSerdes.
 */
export const CHECKPOINT_SIZE_LIMIT_BYTES = 256 * 1024;
