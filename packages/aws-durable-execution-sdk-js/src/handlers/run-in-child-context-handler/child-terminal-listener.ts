import { ChildConfig } from "../../types/child-context";

/**
 * The terminal outcome a child context reports to its listener.
 * @internal
 */
export type ChildTerminalOutcome = "SUCCEEDED" | "FAILED";

/**
 * Called once, synchronously, at the moment a child context records its
 * terminal outcome.
 * @internal
 */
export type ChildTerminalListener = (outcome: ChildTerminalOutcome) => void;

// Keyed on the options object the caller passes to runInChildContext. A
// WeakMap keeps the listener off the public ChildConfig type, and an entry
// disappears with its options object.
const listeners = new WeakMap<object, ChildTerminalListener>();

/**
 * Registers a listener for the child context that will run with `options`.
 *
 * map and parallel use this. A child context settles its promise only after
 * more asynchronous work: plugin hooks and deserialization. That work is
 * longer on the success path than on the failure path. So the order in which
 * item promises settle is not the order in which items recorded their
 * outcome. The listener gives the batch the recording order instead.
 *
 * @returns `options`, so the call can wrap an options literal.
 * @internal
 */
export function withChildTerminalListener<T>(
  options: ChildConfig<T>,
  listener: ChildTerminalListener,
): ChildConfig<T> {
  listeners.set(options, listener);
  return options;
}

/**
 * Reports the terminal outcome of the child context that runs with `options`.
 *
 * The caller invokes this right after it queues the context's terminal
 * checkpoint. A virtual context queues no checkpoint, so its caller invokes
 * this at the same point in the code. The listener runs at most once. A later
 * report for the same options, for example a FAIL after a SUCCEED whose
 * deserialization threw, is ignored.
 * @internal
 */
export function notifyChildTerminal(
  options: object | undefined,
  outcome: ChildTerminalOutcome,
): void {
  if (!options) {
    return;
  }
  const listener = listeners.get(options);
  if (!listener) {
    return;
  }
  listeners.delete(options);
  listener(outcome);
}
