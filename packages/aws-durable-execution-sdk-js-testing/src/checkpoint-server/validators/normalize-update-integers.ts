import { OperationUpdate } from "@aws/durable-execution-sdk-js";
import { toServiceInteger } from "./validate-update-model";

/**
 * Returns a copy of `options` in which each named member that holds a number
 * holds the integer that the service reads. A member that is absent stays
 * absent.
 */
function withIntegers<T extends object>(options: T, members: (keyof T)[]): T {
  const copy = { ...options };
  for (const member of members) {
    const value = copy[member];
    if (typeof value === "number") {
      copy[member] = toServiceInteger(value) as T[keyof T];
    }
  }
  return copy;
}

/**
 * Returns the update with each integer member converted to the integer that
 * the service reads.
 *
 * The service reads an integer member without its fractional part, and
 * clamps it to the 32-bit range. It then applies the integer, not the
 * number in the request. So `WaitSeconds: 1.5` waits 1 second, and
 * `CallbackOptions.TimeoutSeconds: 0.5` is 0, which means no timeout. The
 * local server stores and schedules the update that this function returns.
 * So it waits and records the same values as the service.
 *
 * Call this after `validateCheckpointUpdates`. That function rejects every
 * integer member that is not a finite number. The input update is not
 * changed.
 *
 * @param update - A validated update
 * @returns The update with integer members converted
 */
export function normalizeUpdateIntegers(
  update: OperationUpdate,
): OperationUpdate {
  const normalized: OperationUpdate = { ...update };
  if (update.StepOptions) {
    normalized.StepOptions = withIntegers(update.StepOptions, [
      "NextAttemptDelaySeconds",
    ]);
  }
  if (update.WaitOptions) {
    normalized.WaitOptions = withIntegers(update.WaitOptions, ["WaitSeconds"]);
  }
  if (update.CallbackOptions) {
    normalized.CallbackOptions = withIntegers(update.CallbackOptions, [
      "TimeoutSeconds",
      "HeartbeatTimeoutSeconds",
    ]);
  }
  return normalized;
}
