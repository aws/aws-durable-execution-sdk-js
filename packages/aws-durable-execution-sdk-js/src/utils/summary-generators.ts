import { BatchResult } from "../handlers/concurrent-execution-handler/batch-result";

/**
 * Creates a predefined summary generator for parallel operations
 */
export const createParallelSummaryGenerator =
  () => (result: BatchResult<any>) => {
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
export const createMapSummaryGenerator = () => (result: BatchResult<any>) => {
  return JSON.stringify({
    type: "MapResult",
    totalCount: result.totalCount,
    successCount: result.successCount,
    failureCount: result.failureCount,
    completionReason: result.completionReason,
    status: result.status,
  });
};
