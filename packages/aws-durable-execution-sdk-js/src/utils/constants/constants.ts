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
 * Largest delay `setTimeout` can represent, in milliseconds (~24.9 days).
 *
 * Node does not clamp a delay above this. It emits a TimeoutOverflowWarning and sets the
 * duration to 1 instead, so an unclamped long wait would fire a poll almost immediately and
 * then keep polling for the rest of the invocation. This is a Node limit rather than a
 * property of the compute, so it applies no matter how long an invocation may run -- and it
 * is reachable, since a compute with no deadline reports `Infinity` as its remaining time.
 */
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/**
 * Remaining invocation time, in milliseconds, below which starting another poll is not
 * worthwhile: a poll costs a checkpoint round trip, and there has to be enough time left to
 * receive the result and act on it.
 *
 * This replaces a hard-coded polling budget measured from the first poll, which was unrelated
 * to any particular function's configured timeout: it stopped polling while an invocation may
 * still have had time to run, leaving the operation unobserved until suspension took over.
 *
 * The value is a floor, not a measurement: it is not derived from observed checkpoint
 * latency, and it should be revisited against real p99 data. Anything larger simply stops
 * polling earlier.
 */
export const MIN_REMAINING_TIME_TO_POLL_MS = 1000;

/** Delay before the first poll of an operation with no known end time. */
export const INITIAL_POLL_DELAY_MS = 1000;

/**
 * Ceiling on the polling backoff interval, in milliseconds, and the point at which that
 * ceiling is raised.
 *
 * Polling is bounded in rate rather than in total duration. The hard-coded budget this
 * replaced also acted, accidentally, as a cap on service calls: it ended any poll loop after
 * roughly {@link POLLS_BEFORE_EXTENDED_INTERVAL} checkpoint calls regardless of the
 * invocation. Bounding by the reported deadline removes that cap, and where no deadline is
 * reported there is nothing to bound it at all.
 *
 * The interval therefore widens once a loop has run long enough that the operation is
 * evidently not about to complete, at which point call volume matters more than observing it
 * a few seconds sooner. Anything completing before that point is unaffected, since the
 * interval below the escalation point is unchanged.
 */
export const POLL_INTERVAL_CEILING_MS = 10_000;
export const EXTENDED_POLL_INTERVAL_CEILING_MS = 60_000;
export const POLLS_BEFORE_EXTENDED_INTERVAL = 95;

/**
 * Maximum checkpoint payload size in bytes (256KB).
 * Payloads exceeding this limit trigger ReplayChildren mode in child contexts,
 * and overflow-to-file behavior in FileSystemSerdes.
 */
export const CHECKPOINT_SIZE_LIMIT_BYTES = 256 * 1024;
