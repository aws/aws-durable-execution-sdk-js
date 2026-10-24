import { ConcurrencyController } from "./concurrent-execution-handler";
import {
  BatchItemStatus,
  BatchResult,
  DurableContext,
  DurableExecutionMode,
  DurableLogger,
} from "../../types";
import {
  ChildTerminalOutcome,
  notifyChildTerminal,
} from "../run-in-child-context-handler/child-terminal-listener";

/**
 * One scripted item. The test calls report() to make the item record its
 * terminal outcome, and settle() to make its promise settle. The two are
 * separate because a real child context settles only after plugin hooks and
 * deserialization (issue #967).
 */
interface ScriptedItem {
  report: (outcome: ChildTerminalOutcome) => void;
  settle: () => void;
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

/**
 * Builds a parent context whose runInChildContext hands each item's options
 * and promise controls to the test.
 */
const createScriptedParent = (
  outcomes: ChildTerminalOutcome[],
  onStart?: (index: number, item: ScriptedItem) => void,
): {
  parent: DurableContext<DurableLogger>;
  started: ScriptedItem[];
} => {
  const started: ScriptedItem[] = [];
  const parent = {
    runInChildContext: jest.fn((_name: string, _fn: unknown, options) => {
      const index = started.length;
      let resolve!: (value: unknown) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const item: ScriptedItem = {
        report: (outcome) => notifyChildTerminal(options, outcome),
        settle: () =>
          outcomes[index] === "SUCCEEDED"
            ? resolve(`result-${index}`)
            : reject(new Error(`error-${index}`)),
      };
      started.push(item);
      onStart?.(index, item);
      return promise;
    }),
  } as unknown as DurableContext<DurableLogger>;
  return { parent, started };
};

const itemsOf = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    data: index,
    index,
  }));

describe("ConcurrencyController decides on terminal reports (issue #967)", () => {
  it("decides in report order, not settlement order, and closes the gate at the decision", async () => {
    const events: string[] = [];
    const controller = new ConcurrencyController<DurableLogger>(
      "test",
      undefined,
      (id) => events.push(`close:${id}`),
    );
    const { parent, started } = createScriptedParent([
      "SUCCEEDED",
      "FAILED",
      "SUCCEEDED",
    ]);

    let result: BatchResult<unknown> | undefined;
    void controller
      .executeItems(
        itemsOf(3),
        jest.fn(),
        parent,
        {},
        DurableExecutionMode.ExecutionMode,
        "batch-1",
      )
      .then((r) => {
        result = r;
      });

    // Item 0 records SUCCEEDED, then item 1 records FAILED. Item 1's report
    // makes the default fail-fast batch complete.
    started[0].report("SUCCEEDED");
    events.push("reported:0");
    started[1].report("FAILED");
    events.push("reported:1");
    // Item 2 records its outcome after the decision.
    started[2].report("SUCCEEDED");
    events.push("reported:2");

    expect(events).toEqual([
      "reported:0",
      "close:batch-1",
      "reported:1",
      "reported:2",
    ]);

    // The failure settles first, as on the real failure path.
    started[1].settle();
    await flush();
    // Item 0 has reported but not settled, so the batch still waits for it.
    expect(result).toBeUndefined();

    started[0].settle();
    started[2].settle();
    await flush();

    expect(result!.all.map((item) => item.status)).toEqual([
      BatchItemStatus.SUCCEEDED,
      BatchItemStatus.FAILED,
      BatchItemStatus.STARTED,
    ]);
    expect(result!.getResults()).toEqual(["result-0"]);
    expect(result!.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");
  });

  it("uses settlement as the report when an item settles without reporting", async () => {
    const close = jest.fn();
    const controller = new ConcurrencyController<DurableLogger>(
      "test",
      undefined,
      close,
    );
    const parent = {
      runInChildContext: jest
        .fn()
        .mockResolvedValueOnce("a")
        .mockRejectedValueOnce(new Error("boom"))
        .mockReturnValueOnce(new Promise(() => {})),
    } as unknown as DurableContext<DurableLogger>;

    const result = await controller.executeItems(
      itemsOf(3),
      jest.fn(),
      parent,
      {},
      DurableExecutionMode.ExecutionMode,
      "batch-1",
    );

    expect(result.all.map((item) => item.status)).toEqual([
      BatchItemStatus.SUCCEEDED,
      BatchItemStatus.FAILED,
      BatchItemStatus.STARTED,
    ]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("holds an item's concurrency slot until the item settles", async () => {
    const controller = new ConcurrencyController<DurableLogger>("test");
    // Every item reports synchronously inside runInChildContext, like an item
    // that finished in an earlier invocation.
    const { parent, started } = createScriptedParent(
      ["SUCCEEDED", "SUCCEEDED", "SUCCEEDED"],
      (_index, item) => item.report("SUCCEEDED"),
    );

    const promise = controller.executeItems(itemsOf(3), jest.fn(), parent, {
      maxConcurrency: 1,
    });
    // Item 0 has reported but still runs until it settles.
    expect(started).toHaveLength(1);

    for (let i = 0; i < 3; i++) {
      started[i].settle();
      await flush();
      expect(started).toHaveLength(Math.min(i + 2, 3));
    }

    const result = await promise;
    expect(result.successCount).toBe(3);
    expect(result.completionReason).toBe("ALL_COMPLETED");
  });

  it("starts no item after a decision made while the start loop runs", async () => {
    const controller = new ConcurrencyController<DurableLogger>("test");
    const { parent, started } = createScriptedParent(
      ["SUCCEEDED", "SUCCEEDED", "SUCCEEDED"],
      (_index, item) => item.report("SUCCEEDED"),
    );

    const promise = controller.executeItems(itemsOf(3), jest.fn(), parent, {
      completionConfig: { minSuccessful: 1 },
    });
    expect(started).toHaveLength(1);
    started[0].settle();

    const result = await promise;
    expect(result.all.map((item) => item.status)).toEqual([
      BatchItemStatus.SUCCEEDED,
    ]);
    expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
  });

  it("does not start the next item when an item settles as a failure after reporting SUCCEEDED", async () => {
    const controller = new ConcurrencyController<DurableLogger>("test");
    // Defensive path: child contexts report only final outcomes.
    const { parent, started } = createScriptedParent(["FAILED", "SUCCEEDED"]);

    const promise = controller.executeItems(itemsOf(2), jest.fn(), parent, {
      maxConcurrency: 1,
    });
    started[0].report("SUCCEEDED");
    started[0].settle();

    const result = await promise;
    // The settled failure makes the default fail-fast batch complete before
    // item 1 starts.
    expect(started).toHaveLength(1);
    expect(result.all.map((item) => item.status)).toEqual([
      BatchItemStatus.FAILED,
    ]);
    expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");
  });

  it("counts the settled outcome when an item settles differently than it reported after the decision", async () => {
    const controller = new ConcurrencyController<DurableLogger>("test");
    // Defensive path: child contexts report only final outcomes. Item 0
    // reports SUCCEEDED and then rejects, after item 1's report decided.
    const { parent, started } = createScriptedParent(["FAILED", "SUCCEEDED"]);

    const promise = controller.executeItems(itemsOf(2), jest.fn(), parent, {});
    started[0].report("SUCCEEDED");
    started[1].report("SUCCEEDED");
    started[0].settle();
    started[1].settle();

    const result = await promise;
    expect(result.all.map((item) => item.status)).toEqual([
      BatchItemStatus.FAILED,
      BatchItemStatus.SUCCEEDED,
    ]);
    expect(result.all[0].error?.message).toBe("error-0");
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
    // The default fail-fast reason follows the settled failure.
    expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");
  });
});
