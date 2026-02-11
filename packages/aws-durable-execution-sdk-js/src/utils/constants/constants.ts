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
