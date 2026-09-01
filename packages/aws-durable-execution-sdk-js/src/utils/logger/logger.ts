import { safeStringify } from "../safe-stringify/safe-stringify";

// Cached at module load: reading process.env is a native call, and log() is
// invoked in hot paths (checkpoint queue processing) where the common case is
// logging disabled.
let verbose = process.env.DURABLE_VERBOSE_MODE === "true";

/**
 * Re-reads DURABLE_VERBOSE_MODE from the environment. The flag is cached for
 * performance; call this if the environment variable changes at runtime
 * (e.g., CLI tools enabling verbose mode after the SDK has loaded).
 *
 * @public
 */
export const refreshLogConfig = (): void => {
  verbose = process.env.DURABLE_VERBOSE_MODE === "true";
};

/**
 * Log a debug message when verbose mode is enabled.
 *
 * `data` may be a value or a zero-arg function (thunk). Thunks are only
 * evaluated when logging is enabled, letting hot call sites avoid building
 * argument objects that would be discarded.
 *
 * Note: any function-valued `data` is treated as a thunk and invoked — the
 * union collapses to `unknown` in the signature, so this contract is only
 * expressed here. To log a function value itself, wrap it: `() => fn`.
 */
export const log = (
  emoji: string,
  message: string,
  data?: unknown | (() => unknown),
): void => {
  if (!verbose) {
    return;
  }
  const resolved =
    typeof data === "function" ? (data as () => unknown)() : data;
  console.debug(`${emoji} ${message}`, resolved ? safeStringify(resolved) : "");
};
