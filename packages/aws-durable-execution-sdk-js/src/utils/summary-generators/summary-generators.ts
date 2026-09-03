import { BatchResult } from "../../types";
import { BatchItemStatus } from "../../types/batch";

/**
 * Marker characters for {@link encodeItemStatuses}. One character per item, in
 * item-index order.
 */
const ITEM_STATUS_SUCCEEDED = "S";
const ITEM_STATUS_FAILED = "F";
/** Started-but-unfinished, or never started. Both are "do not rebuild". */
const ITEM_STATUS_INCOMPLETE = "-";

/**
 * Encodes which items reached a terminal state, one character per item in index
 * order (`S` succeeded, `F` failed, `-` neither).
 *
 * Replay of a summarized batch has to know which items completed. Probing the
 * checkpoints cannot answer that reliably:
 *
 *  - A virtual (FLAT) item has no context checkpoint of its own, so there is
 *    nothing to probe directly.
 *  - Probing the item's first child operation is unsound for multi-operation
 *    items: an item that was still in flight can have a SUCCEEDED first
 *    operation and would be misread as finished, then re-driven — duplicating
 *    the side effects of its unfinished operations and rebuilding a batch
 *    containing items the live run never completed.
 *
 * Recording the outcome the live run observed removes both ambiguities. Only
 * terminality has to be recorded: an item's SUCCEEDED/FAILED outcome comes from
 * re-driving it during replay, not from this record.
 *
 * SIZE: no size handling is needed here, and none should be added. Every batch
 * item runs its body inside a context, and a context is meant to wrap at least
 * one durable operation (see `DurableContext.runInChildContext`), so each item
 * costs at least one operation. The service caps an execution at 30,000
 * operations, which bounds any batch at roughly that many items — about 30 KB of
 * markers at one byte each, comfortably inside the 256 KB checkpoint limit that
 * put this batch on the summarized path in the first place.
 *
 * Capping the marker count instead would be actively harmful: dropping the field
 * sends replay back to probing the checkpoints, and probing cannot recover a
 * completed item whose body created no durable operation — which is the very
 * corruption this record exists to prevent.
 */
export const encodeItemStatuses = <T>(result: BatchResult<T>): string => {
  const items = result.all ?? [];
  if (items.length === 0) {
    return "";
  }

  let maxIndex = -1;
  for (const item of items) {
    if (typeof item.index === "number" && item.index > maxIndex) {
      maxIndex = item.index;
    }
  }
  if (maxIndex < 0) {
    return "";
  }

  const encoded = new Array<string>(maxIndex + 1).fill(ITEM_STATUS_INCOMPLETE);
  for (const item of items) {
    if (typeof item.index !== "number") {
      continue;
    }
    if (item.status === BatchItemStatus.SUCCEEDED) {
      encoded[item.index] = ITEM_STATUS_SUCCEEDED;
    } else if (item.status === BatchItemStatus.FAILED) {
      encoded[item.index] = ITEM_STATUS_FAILED;
    }
  }
  return encoded.join("");
};

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
      itemStatuses: encodeItemStatuses(result),
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
      itemStatuses: encodeItemStatuses(result),
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
