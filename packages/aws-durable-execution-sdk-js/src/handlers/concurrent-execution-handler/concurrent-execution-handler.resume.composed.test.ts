import { createTestDurableContext } from "../../testing/create-test-durable-context";
import {
  BatchItemStatus,
  CompletionOutcome,
  completeBatch,
  continueBatch,
} from "../../types";
import { OperationStatus, OperationType } from "../../types/wire";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

type Recorded = "SUCCEEDED" | "FAILED" | "STARTED";

/**
 * A map resumes after an earlier invocation ended between the item
 * checkpoints and the map checkpoint. So the map context is still STARTED,
 * and the given items have a terminal record. Item i is the child context
 * `1-${i + 1}`.
 */
const resumedOperations = (recorded: Recorded[]) => [
  {
    Id: hashId("1"),
    Type: OperationType.CONTEXT,
    SubType: "Map",
    Name: "m",
    StartTimestamp: new Date(),
    Status: OperationStatus.STARTED,
  },
  ...recorded.map((outcome, index) => ({
    Id: hashId(`1-${index + 1}`),
    ParentId: hashId("1"),
    Type: OperationType.CONTEXT,
    SubType: "MapIteration",
    Name: `map-item-${index}`,
    StartTimestamp: new Date(),
    Status:
      outcome === "SUCCEEDED"
        ? OperationStatus.SUCCEEDED
        : outcome === "FAILED"
          ? OperationStatus.FAILED
          : OperationStatus.STARTED,
    ...(outcome === "SUCCEEDED"
      ? { ContextDetails: { Result: JSON.stringify(index * 10) } }
      : outcome === "FAILED"
        ? {
            ContextDetails: {
              Error: { ErrorType: "Error", ErrorMessage: `boom-${index}` },
            },
          }
        : {}),
  })),
];

const statusesOf = (result: { all: { status: BatchItemStatus }[] }) =>
  result.all.map((item) => item.status);

describe("map resumed with several terminal item records", () => {
  it("keeps a recorded failure that settles after recorded successes reach minSuccessful", async () => {
    // In the earlier invocation, items 0 and 1 started. Item 1 succeeded, so
    // item 2 started. Item 2 failed, so item 3 started. Item 0 then succeeded,
    // which reached minSuccessful: 2. The invocation ended before the map
    // checkpoint.
    const { context } = createTestDurableContext({
      existingOperations: resumedOperations([
        "SUCCEEDED",
        "SUCCEEDED",
        "FAILED",
      ]) as never,
    });
    const executed: number[] = [];

    const result = await context.map(
      "m",
      [0, 1, 2, 3],
      async (_child, item) => {
        executed.push(item);
        return item * 10;
      },
      { maxConcurrency: 2, completionConfig: { minSuccessful: 2 } },
    );

    // Without the fix, items 0 and 1 reach minSuccessful first, and the
    // recorded failure of item 2 is reported STARTED.
    expect(statusesOf(result)).toEqual([
      BatchItemStatus.SUCCEEDED,
      BatchItemStatus.SUCCEEDED,
      BatchItemStatus.FAILED,
    ]);
    expect(result.hasFailure).toBe(true);
    expect(result.failed()[0].error?.message).toContain("boom-2");
    expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
    expect(executed).toEqual([]);
  });

  it("keeps two recorded successes with unlimited concurrency", async () => {
    // Without the fix, item 0's cached success completes the batch before
    // item 1's cached success settles, and item 1 is reported STARTED.
    const { context } = createTestDurableContext({
      existingOperations: resumedOperations([
        "SUCCEEDED",
        "SUCCEEDED",
      ]) as never,
    });
    const executed: number[] = [];

    const result = await context.map(
      "m",
      [0, 1, 2],
      async (_child, item) => {
        executed.push(item);
        return item * 10;
      },
      { completionConfig: { minSuccessful: 1 } },
    );

    expect(statusesOf(result)).toEqual([
      BatchItemStatus.SUCCEEDED,
      BatchItemStatus.SUCCEEDED,
    ]);
    expect(result.getResults()).toEqual([0, 10]);
    // Item 2 is after the last recorded item, so it starts only if the
    // completion rule allows it. minSuccessful is already reached.
    expect(executed).toEqual([]);
  });

  it("starts no item after the last recorded item once fail-fast has stopped the batch", async () => {
    // In the earlier invocation, item 0 failed, which stopped the batch.
    // Item 1 recorded its success before the batch context finished.
    const { context } = createTestDurableContext({
      existingOperations: resumedOperations(["FAILED", "SUCCEEDED"]) as never,
    });
    const executed: number[] = [];

    const result = await context.map(
      "m",
      [0, 1, 2, 3],
      async (_child, item) => {
        executed.push(item);
        return item * 10;
      },
      { maxConcurrency: 2 },
    );

    expect(statusesOf(result)).toEqual([
      BatchItemStatus.FAILED,
      BatchItemStatus.SUCCEEDED,
    ]);
    expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");
    expect(executed).toEqual([]);
  });

  it("does not start a later item while a recorded item still deserializes", async () => {
    // Item 1's cached result takes longer to deserialize than item 0's. The
    // batch must not start item 2 while it waits, because minSuccessful: 1
    // is already reached once the recorded items have settled.
    let releaseItem1!: () => void;
    const item1Held = new Promise<void>((resolve) => {
      releaseItem1 = resolve;
    });
    const itemSerdes = {
      serialize: async (value: number | undefined) =>
        value === undefined ? undefined : JSON.stringify(value),
      deserialize: async (data: string | undefined) => {
        const value = data === undefined ? undefined : JSON.parse(data);
        if (value === 10) {
          await item1Held;
        }
        return value as number | undefined;
      },
    };
    const { context } = createTestDurableContext({
      existingOperations: resumedOperations([
        "SUCCEEDED",
        "SUCCEEDED",
      ]) as never,
    });
    const executed: number[] = [];

    const pending = context.map(
      "m",
      [0, 1, 2],
      async (_child, item) => {
        executed.push(item);
        // Item 2 would fail, so starting it would set hasFailure.
        throw new Error(`item-${item}`);
      },
      {
        maxConcurrency: 2,
        itemSerdes,
        completionConfig: { minSuccessful: 1 },
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(executed).toEqual([]);
    releaseItem1();

    const result = await pending;
    expect(statusesOf(result)).toEqual([
      BatchItemStatus.SUCCEEDED,
      BatchItemStatus.SUCCEEDED,
    ]);
    expect(result.hasFailure).toBe(false);
    expect(executed).toEqual([]);
  });

  it.each([
    ["SUCCEEDED", CompletionOutcome.SUCCEEDED, "CUSTOM_COMPLETION_SUCCEEDED"],
    ["FAILED", CompletionOutcome.FAILED, "CUSTOM_COMPLETION_FAILED"],
  ] as const)(
    "keeps a custom predicate's decision made while recorded items settle (outcome %s)",
    async (_name, outcome, reason) => {
      // In the earlier invocation, items 0 and 1 started together. The first
      // to settle made the predicate complete. The other recorded its
      // outcome before the map context finished.
      const { context } = createTestDurableContext({
        existingOperations: resumedOperations([
          "SUCCEEDED",
          "SUCCEEDED",
        ]) as never,
      });
      const executed: number[] = [];

      const result = await context.map(
        "m",
        [0, 1, 2],
        async (_child, item) => {
          executed.push(item);
          return item * 10;
        },
        {
          maxConcurrency: 2,
          completionConfig: {
            // Not monotone: it completes only at the first settlement.
            shouldComplete: ({ completedCount }) =>
              completedCount === 1 ? completeBatch(outcome) : continueBatch(),
          },
        },
      );

      expect(statusesOf(result)).toEqual([
        BatchItemStatus.SUCCEEDED,
        BatchItemStatus.SUCCEEDED,
      ]);
      expect(result.completionReason).toBe(reason);
      expect(result.status).toBe(outcome);
      expect(executed).toEqual([]);
    },
  );
});

describe("map resumed with a predicate that does not stay complete", () => {
  it("can decide differently than the original run (documented limit)", async () => {
    // Original run, maxConcurrency 2: item 0 succeeded, which completed the
    // batch at (successCount 1, failureCount 0). Item 1 then recorded a
    // failure before the batch checkpoint. Item 2 never started.
    const { context } = createTestDurableContext({
      existingOperations: resumedOperations(["SUCCEEDED", "FAILED"]) as never,
    });
    const seen: string[] = [];
    const executed: number[] = [];

    const result = await context.map(
      "m",
      [0, 1, 2],
      async (_child, item) => {
        executed.push(item);
        return item * 10;
      },
      {
        maxConcurrency: 2,
        completionConfig: {
          shouldComplete: ({ successCount, failureCount, completedCount }) => {
            seen.push(`${completedCount}:(${successCount},${failureCount})`);
            return successCount === 1 && failureCount === 0
              ? completeBatch()
              : continueBatch();
          },
        },
      },
    );

    // On resume the cached failure settles before the cached success. So the
    // predicate sees (0, 1) and then (1, 1), never (1, 0), and item 2 runs.
    // The shouldComplete docs ask for a predicate that stays complete as the
    // counts grow, which avoids this.
    expect(seen.slice(0, 2)).toEqual(["1:(0,1)", "2:(1,1)"]);
    expect(executed).toEqual([2]);
    expect(result.all.map((item) => item.status)).toEqual([
      BatchItemStatus.SUCCEEDED,
      BatchItemStatus.FAILED,
      BatchItemStatus.SUCCEEDED,
    ]);
  });
});

describe("map resumed with an unfinished item between recorded items", () => {
  // Cached successes deserialize only when released, so the cached failure of
  // item 0 settles first, as in the earlier invocation's order.
  const heldSuccesses = () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const itemSerdes = {
      serialize: async (value: number | undefined) =>
        value === undefined ? undefined : JSON.stringify(value),
      deserialize: async (data: string | undefined) => {
        await held;
        return (data === undefined ? undefined : JSON.parse(data)) as
          | number
          | undefined;
      },
    };
    return { itemSerdes, release };
  };

  it("does not run the unfinished item once fail-fast has decided", async () => {
    // Reachable history: items 1 and 2 finished and started items 3 and 4.
    // Item 4 finished, then item 0 failed. Item 3 was still running.
    const { context } = createTestDurableContext({
      existingOperations: resumedOperations([
        "FAILED",
        "SUCCEEDED",
        "SUCCEEDED",
        "STARTED",
        "SUCCEEDED",
      ]) as never,
    });
    const { itemSerdes, release } = heldSuccesses();
    const executed: number[] = [];

    const pending = context.map(
      "m",
      [0, 1, 2, 3, 4],
      async (_child, item) => {
        executed.push(item);
        return item * 10;
      },
      { maxConcurrency: 3, itemSerdes },
    );
    await new Promise((resolve) => setImmediate(resolve));
    // Item 0's failure is known. Item 3 must not run.
    expect(executed).toEqual([]);
    release();

    const result = await pending;
    expect(result.all.map((item) => `${item.index}:${item.status}`)).toEqual([
      "0:FAILED",
      "1:SUCCEEDED",
      "2:SUCCEEDED",
      "4:SUCCEEDED",
    ]);
    expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");
    expect(executed).toEqual([]);
  });

  it("runs the unfinished item while the outcome is still open", async () => {
    // minSuccessful: 3 is not reached by the recorded items alone. So the
    // unfinished item 1 runs again, as it would without the recorded items.
    const { context } = createTestDurableContext({
      existingOperations: resumedOperations([
        "SUCCEEDED",
        "STARTED",
        "SUCCEEDED",
      ]) as never,
    });
    const executed: number[] = [];

    const result = await context.map(
      "m",
      [0, 1, 2, 3],
      async (_child, item) => {
        executed.push(item);
        return item * 10;
      },
      { maxConcurrency: 2, completionConfig: { minSuccessful: 3 } },
    );

    expect(executed).toEqual([1]);
    expect(result.all.map((item) => item.status)).toEqual([
      BatchItemStatus.SUCCEEDED,
      BatchItemStatus.SUCCEEDED,
      BatchItemStatus.SUCCEEDED,
    ]);
    expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
  });
});

describe("map after it resolves", () => {
  it("starts no item when an item that was still running settles", async () => {
    const { context } = createTestDurableContext();
    const executed: number[] = [];
    let releaseItem1!: () => void;
    const item1Held = new Promise<void>((resolve) => {
      releaseItem1 = resolve;
    });

    const result = await context.map(
      "m",
      [0, 1, 2],
      async (_child, item) => {
        executed.push(item);
        if (item === 1) {
          await item1Held;
        }
        return item;
      },
      {
        maxConcurrency: 2,
        completionConfig: {
          // Not monotone: it completes at the first settlement and returns
          // continue afterwards.
          shouldComplete: ({ completedCount }) =>
            completedCount === 1 ? completeBatch() : continueBatch(),
        },
      },
    );
    expect(result.completionReason).toBe("CUSTOM_COMPLETION_SUCCEEDED");

    // Item 1 settles after the map has returned. Without the guard, its
    // settlement re-evaluates the predicate, gets continue, and starts item 2.
    releaseItem1();
    await new Promise((resolve) => setImmediate(resolve));
    expect(executed).toEqual([0, 1]);
  });
});
