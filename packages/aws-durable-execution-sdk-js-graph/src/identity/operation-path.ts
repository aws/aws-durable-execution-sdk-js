import { createHash } from "crypto";

/**
 * Operation-name construction for the graph runtime.
 *
 * # Why this exists (the POC's central constraint)
 *
 * The core SDK mints operation *identity* positionally: an operation's id is its ordinal
 * within its parent context (e.g. `3-2-1`). `createStepId` is private and there is no public
 * seam to override it in v2.3.0, so this POC cannot supply path-based ids
 * (design doc §5, §6). Instead we take the design doc's §6 *fallback*: keep the positional
 * ids the SDK assigns, and encode the graph-structural path into the operation **`Name`**.
 *
 * The name is therefore purely observational and diagnostic here — it is NOT the dedup key.
 * The SDK still dedups on the positional id. But encoding the path in the name gives us:
 *
 *   1. a human-readable execution tree that renders as a graph, and
 *   2. a value we can *attest* against on replay (frontier attestation, §5.4) to convert the
 *      silent-re-execution risk of the eventual path-identity scheme into a loud failure even
 *      while we are still on positional ids.
 *
 * # The hard rule (design doc §5.3, brief invariant 4)
 *
 * A path MUST be a pure function of *logical position* — `(tick, nodeName, localName)` — and
 * MUST NOT incorporate wall-clock time, RNG, UUIDs, attempt counters, operation inputs, or
 * graph state values. This is what lets a replay recompute the identical path.
 */

/** Separator between a tick segment and a node segment: `t0/model`. */
const SEGMENT_SEP = "/";

/**
 * Build the structural path for a superstep (tick) context.
 *
 * @param tick - The superstep index. Non-negative integer.
 * @returns e.g. `"t0"`, `"t3"`.
 */
export function tickPath(tick: number): string {
  return `t${tick}`;
}

/**
 * Build the structural path for a node running within a superstep.
 *
 * @param tick - The superstep index.
 * @param nodeName - The node's name (part of the address space; renaming is breaking, §5.5).
 * @returns e.g. `"t0/model"`, `"t1/tools"`.
 */
export function nodePath(tick: number, nodeName: string): string {
  return `${tickPath(tick)}${SEGMENT_SEP}${nodeName}`;
}

/**
 * Build the structural path for a named local operation inside a node — e.g. a step, or the
 * interrupt callback. `localName` disambiguates multiple operations within one node body.
 *
 * @param tick - The superstep index.
 * @param nodeName - The node's name.
 * @param localName - A stable, caller-chosen local label (must not depend on state/clock/RNG).
 * @returns e.g. `"t2/model/invoke-model"`, `"t3/tools/approval"`.
 */
export function localPath(
  tick: number,
  nodeName: string,
  localName: string,
): string {
  return `${nodePath(tick, nodeName)}${SEGMENT_SEP}${localName}`;
}

/**
 * Hash a structural path to a stable 16-hex-char token, matching the core SDK's own
 * MD5-truncate-to-16-hex convention (`src/utils/step-id-utils`). We do NOT rely on this for
 * identity in the POC (the SDK ids remain positional), but design doc §5.6 flags a potential
 * `Operation.Id` length cap, and hashing here keeps names bounded and demonstrates the
 * convention a real path-identity scheme (Phase 2) would use.
 *
 * MD5 is used deliberately for parity with the SDK convention; this is not a security
 * primitive.
 *
 * @param path - A structural path such as `t2/model/invoke-model`.
 * @returns A 16-character lowercase hex string.
 */
export function hashPath(path: string): string {
  return createHash("md5").update(path).digest("hex").slice(0, 16);
}
