import { BatchResult } from "../../types";

/**
 * Creates a predefined summary generator for parallel operations
 */
export const createParallelSummaryGenerator =
  <T>() =>
  (result: BatchResult<T>): string => {
    return JSON.stringify({
      type: "ParallelResult",
      totalCount: result.totalCount,
      successCount: result.successCount,
      failureCount: result.failureCount,
      startedCount: result.startedCount,
      completionReason: result.completionReason,
      status: result.status,
    });
  };

/**
 * Creates a predefined summary generator for map operations
 */
export const createMapSummaryGenerator =
  <T>() =>
  (result: BatchResult<T>): string => {
    return JSON.stringify({
      type: "MapResult",
      totalCount: result.totalCount,
      successCount: result.successCount,
      failureCount: result.failureCount,
      completionReason: result.completionReason,
      status: result.status,
    });
  };

/**
 * Composes the SDK's internal summary generator with an optional
 * customer-supplied one.
 *
 * The internal generator's record is always written to the checkpoint so the
 * fields replay depends on (`totalCount`, `successCount`, `failureCount`,
 * `completionReason`, `status`) are present regardless of what a custom
 * generator returns. When a custom generator is supplied, its output is
 * preserved verbatim under a `summary` key — observability-only, exactly as the
 * developer guide documents. This keeps replay correctness independent of the
 * customer's string: the customer's value can never displace the SDK metadata.
 *
 * When no custom generator is supplied, the internal record is returned
 * unchanged (identical to the previous default behavior).
 */
export const composeSummaryGenerator =
  <T>(
    internalGenerator: (result: BatchResult<T>) => string,
    customGenerator?: (result: BatchResult<T>) => string,
  ) =>
  (result: BatchResult<T>): string => {
    const internal = internalGenerator(result);
    if (!customGenerator) {
      return internal;
    }

    let record: Record<string, unknown>;
    try {
      const parsed = JSON.parse(internal);
      record =
        parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      record = {};
    }

    // Customer output is stored verbatim (as a string) so it stays purely
    // observational and never collides with the SDK metadata keys.
    record.summary = customGenerator(result);
    return JSON.stringify(record);
  };
