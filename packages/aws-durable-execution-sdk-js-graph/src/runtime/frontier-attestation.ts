import { DurableContext } from "@aws/durable-execution-sdk-js";
import { GraphDriftError } from "./errors";
import { tickPath } from "../identity";

/**
 * Frontier attestation (design doc §4.4 `assertFrontierMatchesRecord`, §5.4).
 *
 * Each tick, the driver computes the ordered frontier it is about to dispatch. We record that
 * frontier in a durable {@link DurableContext.step}, keyed by the tick's structural path
 * (encoded in the step name — the §6 fallback). Because a step's result is checkpointed and
 * replayed:
 *
 *   - On the **first** run, the step records and returns the just-computed frontier. No drift
 *     is possible (recorded === computed by construction).
 *   - On a **replay**, the step returns the *recorded* frontier (it does not re-run its body).
 *     We compare it against the frontier the driver *just* recomputed from checkpointed state.
 *     A mismatch means routing or topology diverged between runs → {@link GraphDriftError}.
 *
 * This is the safety net that the eventual path-identity scheme (Phase 2) must have, rebuilt
 * explicitly. We implement it now, even though positional ids already give the SDK its own
 * drift detection, so the mechanism is exercised and the demo can show a loud failure.
 *
 * The step body is pure (it returns its input) and performs no I/O, so it re-runs safely if it
 * ever does execute. The comparison itself is done in the handler (outside the step) against
 * the step's returned value.
 *
 * @param ctx - The graph root context (the tick steps are children of it).
 * @param tick - The superstep index.
 * @param computed - The ordered frontier the driver just computed for this tick.
 * @throws {GraphDriftError} if the recorded frontier differs from `computed`.
 */
export async function assertFrontierMatchesRecord(
  ctx: DurableContext,
  tick: number,
  computed: string[],
): Promise<void> {
  // Snapshot the value at call time; the step body must not close over anything mutable that
  // could differ on replay. `computed` is a fresh array each tick.
  const snapshot = [...computed];

  const recorded = await ctx.step<string[]>(
    `attest-${tickPath(tick)}`,
    // Pure body: records the frontier on first run, replayed verbatim thereafter.
    async () => snapshot,
  );

  if (!frontiersEqual(recorded, computed)) {
    throw new GraphDriftError(
      "Graph frontier drift detected on replay",
      tick,
      recorded,
      computed,
    );
  }
}

/** Order-sensitive equality. The driver always passes an ordered frontier, so order is part of the attestation (positional ids make ordering load-bearing — brief invariant 6). */
function frontiersEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
