import { createTestDurableContext } from "../../testing/create-test-durable-context";
import { BatchItemStatus } from "../../types";
import { OperationStatus, OperationType } from "../../types/wire";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

/**
 * A map resumes after an earlier invocation ended between the item
 * checkpoints and the map checkpoint. In that invocation, item 1 failed
 * first and item 0 then succeeded, which reached minSuccessful: 1. So both
 * items have a terminal record, and the map context is still STARTED.
 */
const resumedOperations = () => [
  {
    Id: hashId("1"),
    Type: OperationType.CONTEXT,
    SubType: "Map",
    Name: "m",
    StartTimestamp: new Date(),
    Status: OperationStatus.STARTED,
  },
  {
    Id: hashId("1-1"),
    ParentId: hashId("1"),
    Type: OperationType.CONTEXT,
    SubType: "MapIteration",
    Name: "map-item-0",
    StartTimestamp: new Date(),
    Status: OperationStatus.SUCCEEDED,
    ContextDetails: { Result: JSON.stringify(0) },
  },
  {
    Id: hashId("1-2"),
    ParentId: hashId("1"),
    Type: OperationType.CONTEXT,
    SubType: "MapIteration",
    Name: "map-item-1",
    StartTimestamp: new Date(),
    Status: OperationStatus.FAILED,
    ContextDetails: {
      Error: { ErrorType: "Error", ErrorMessage: "boom" },
    },
  },
];

describe("map resumed with several terminal item records", () => {
  it.each([
    // Every item starts at once, so item 2 starts too. It is still running
    // when the batch completes, so it is reported STARTED.
    [
      "unlimited concurrency",
      undefined,
      [
        BatchItemStatus.SUCCEEDED,
        BatchItemStatus.FAILED,
        BatchItemStatus.STARTED,
      ],
      [2],
    ],
    // Item 2 would start only after item 1 settles, and the batch completes
    // then. So item 2 never starts.
    [
      "maxConcurrency 1",
      1,
      [BatchItemStatus.SUCCEEDED, BatchItemStatus.FAILED],
      [],
    ],
  ])(
    "keeps every recorded outcome before applying minSuccessful (%s)",
    async (_name, maxConcurrency, statuses, executedItems) => {
      const { context } = createTestDurableContext({
        existingOperations: resumedOperations() as never,
      });
      const executed: number[] = [];

      const result = await context.map(
        "m",
        [0, 1, 2],
        async (_child, item) => {
          executed.push(item);
          // Never settles in this invocation.
          await new Promise(() => {});
          return item * 10;
        },
        { maxConcurrency, completionConfig: { minSuccessful: 1 } },
      );

      // Item 1's recorded failure is kept, even though item 0's recorded
      // success alone reaches minSuccessful.
      expect(result.all.map((item) => item.status)).toEqual(statuses);
      expect(result.failureCount).toBe(1);
      expect(result.hasFailure).toBe(true);
      expect(result.failed()[0].error?.message).toContain("boom");
      expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
      // Recorded items return their cached outcome. Only item 2 can run.
      expect(executed).toEqual(executedItems);
    },
  );
});
