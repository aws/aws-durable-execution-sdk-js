// Internal helpers for `pluginsConfig.childOperationsDepth`. Kept in their own
// module (not re-exported from the package entrypoint) so they can be unit
// tested without becoming part of the public API.

/**
 * Validates `pluginsConfig.childOperationsDepth`: it must be `undefined`, a
 * non-negative integer, or `Infinity`. Returns an error message describing the
 * problem for an invalid value, or `undefined` when valid. Invalid config is a
 * non-retryable error — the caller fails the execution with it rather than
 * silently proceeding.
 * @internal
 */
export function validateChildOperationsDepth(
  childOperationsDepth: number | undefined,
): string | undefined {
  if (childOperationsDepth === undefined) return undefined;
  if (childOperationsDepth === Infinity) return undefined;
  if (
    typeof childOperationsDepth !== "number" ||
    Number.isNaN(childOperationsDepth) ||
    !Number.isInteger(childOperationsDepth) ||
    childOperationsDepth < 0
  ) {
    return (
      `pluginsConfig.childOperationsDepth must be a non-negative integer or ` +
      `Infinity; got ${String(childOperationsDepth)}.`
    );
  }
  return undefined;
}

/**
 * Maps the (already-validated) public `pluginsConfig.childOperationsDepth`
 * (where 1 = children of top-level contexts) to the root context's internal
 * preserve-child budget. The budget is decremented once per nesting level
 * before it governs a context's children, so the root is seeded at `depth + 1`.
 * `undefined`/`0` disables preservation; `Infinity` preserves the whole tree.
 * @internal
 */
export function resolveRootPreserveChildDepth(
  childOperationsDepth: number | undefined,
): number {
  if (childOperationsDepth === undefined || childOperationsDepth <= 0) return 0;
  if (childOperationsDepth === Infinity) return Infinity;
  return childOperationsDepth + 1;
}
