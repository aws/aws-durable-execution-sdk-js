/**
 * Thrown when the frontier recomputed on replay does not match the frontier that was recorded
 * on the original run (design doc §5.4, §9).
 *
 * # Why this is a day-one requirement
 *
 * Positional identity (what the SDK uses, and what this POC rides on — brief) gives *free*
 * drift detection: if control flow changes between replays, the operation in a given slot
 * carries the wrong recorded `Name`, and the SDK's `validateReplayConsistency` fails loudly.
 *
 * The eventual path-based identity scheme (Phase 2) *loses* that safety net: a changed path is
 * indistinguishable from a brand-new operation, so non-determinism would become *silent
 * re-execution*. The design doc mandates engineering detection back in from day one. We
 * implement it here even under positional ids so the mechanism is proven and the demo shows a
 * loud `GraphDriftError` rather than a silent divergence.
 */
export class GraphDriftError extends Error {
  constructor(
    message: string,
    public readonly tick: number,
    public readonly recorded: string[],
    public readonly computed: string[],
  ) {
    super(
      `${message} (tick ${tick}: recorded=[${recorded.join(
        ", ",
      )}] computed=[${computed.join(", ")}])`,
    );
    this.name = "GraphDriftError";
    Object.setPrototypeOf(this, GraphDriftError.prototype);
  }
}
