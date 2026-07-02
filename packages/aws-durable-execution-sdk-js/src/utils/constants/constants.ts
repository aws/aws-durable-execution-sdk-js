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
 * Maximum polling duration in milliseconds (15 minutes)
 * Used to cap setTimeout delays to prevent 32-bit signed integer overflow
 * and limit polling duration for long-running operations
 */
export const MAX_POLL_DURATION_MS = 15 * 60 * 1000;

/**
 * Maximum checkpoint payload size in bytes (256KB).
 * Payloads exceeding this limit trigger ReplayChildren mode in child contexts,
 * and overflow-to-file behavior in FileSystemSerdes.
 */
export const CHECKPOINT_SIZE_LIMIT_BYTES = 256 * 1024;
