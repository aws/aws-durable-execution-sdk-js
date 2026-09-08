import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { NestingType } from "@aws/durable-execution-sdk-js";
import { handler } from "./map-flat-summarized-replay";

const ITEM_COUNT = 8;

/**
 * A map whose aggregate result exceeds the 256KB checkpoint limit is
 * checkpointed as a summary with ContextOptions.ReplayChildren, and on every
 * later resumption is rebuilt from its child checkpoints by
 * ConcurrencyController.replayItems.
 *
 * replayItems decided whether each item finished by probing the item's context
 * checkpoint (`${mapId}-${n}`). With `nesting: FLAT` those per-item contexts are
 * VIRTUAL and never checkpointed, so the probe found nothing, every item was
 * treated as non-terminal and skipped, and the rebuilt BatchResult came back
 * EMPTY even though all items had succeeded.
 *
 * Why that is severe rather than cosmetic: code deriving control flow from the
 * batch result (for example a fan-out sized from the results) creates a
 * different set of operations on replay than it did live. The replay-consistency
 * check then detects the divergence and raises NonDeterministicExecutionError,
 * which SDKs at or below 2.3.0 reported as a PENDING response instead of a
 * failure. While other work is still draining, PENDING is a legal answer and the
 * corruption stays invisible; once nothing is left pending the service rejects
 * the response outright ("Cannot return PENDING status with no pending
 * operations"), retries deterministically, and fails the execution.
 *
 * Only large maps are affected: a result that fits in one checkpoint is stored
 * whole and replayed by deserialization, never entering the rebuild path.
 *
 * The fix records, in the batch summary, which items reached a terminal state.
 * Replay reads that record rather than inferring terminality from the
 * checkpoints, which is what makes the two otherwise undecidable cases
 * decidable: an item that was mid-flight with a finished first operation, and an
 * item whose body creates no durable operation and therefore leaves no trace at
 * all. An item's SUCCEEDED/FAILED outcome still comes from re-driving it, so the
 * record only has to answer "did this finish".
 *
 * Consequence worth knowing: a virtual item with no durable operation of its own
 * is re-driven on replay, so any part of the mapper body not wrapped in a
 * durable operation runs again. That is the documented contract for virtual
 * contexts, and is what NESTED already does, but it is new for this path.
 *
 * NOTE: a fresh test environment is created per test on purpose. Sharing one
 * environment lets the virtual clock carry over between runs, which can let the
 * in-invocation poll timer resolve the wait without ever suspending. No replay
 * would happen and the FLAT cases would silently pass. The invocation-count
 * guards below protect against that regressing.
 */
describe("map with ReplayChildren (result > 256KB) replayed across a suspension", () => {
  beforeEach(async () => {
    await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
  });

  afterEach(async () => {
    await LocalDurableTestRunner.teardownTestEnvironment();
  });

  it.each([
    ["FLAT", NestingType.FLAT],
    ["NESTED", NestingType.NESTED],
  ] as const)(
    "rebuilds the full batch result on replay (%s nesting)",
    async (_label, nesting) => {
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });

      const execution = await runner.run({ payload: { nesting } });

      // Guard: the wait must actually have suspended the first invocation,
      // otherwise no replay occurred and this test is not exercising
      // replayItems at all.
      expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toEqual({
        liveResultCount: ITEM_COUNT,
        // Before the fix, FLAT returned 0 and [] here: replayItems could not
        // see terminal virtual items, so the rebuilt batch was empty.
        replayedResultCount: ITEM_COUNT,
        replayedItems: Array.from({ length: ITEM_COUNT }, (_, i) => i),
      });
    },
    30000,
  );

  it("rebuilds FLAT items that checkpoint no durable operation of their own", async () => {
    // A mapper that performs no durable operation leaves nothing beneath a
    // virtual item, so probing the checkpoints cannot tell that the item ran —
    // it is indistinguishable from one that never started. Only the per-item
    // statuses recorded in the summary identify it, so this case is rebuilt
    // solely on the strength of that record.
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const execution = await runner.run({
      payload: { nesting: NestingType.FLAT, noDurableOperation: true },
    });

    expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);
    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({
      liveResultCount: ITEM_COUNT,
      replayedResultCount: ITEM_COUNT,
      replayedItems: Array.from({ length: ITEM_COUNT }, (_, i) => i),
    });
  }, 30000);

  it("replays a small result from cache without entering the rebuild path", async () => {
    // A result that fits inside a single checkpoint is stored whole, so replay
    // is a deserialization rather than a reconstruction. This is the boundary
    // case that always worked, kept here so a regression in the rebuild path
    // cannot be mistaken for a general replay failure.
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const execution = await runner.run({
      payload: { nesting: NestingType.FLAT, itemPayloadSize: 16 },
    });

    // Same guard as the other cases: without a suspension there is no replay at
    // all, and this test would pass without exercising anything.
    expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);
    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({
      liveResultCount: ITEM_COUNT,
      replayedResultCount: ITEM_COUNT,
      replayedItems: Array.from({ length: ITEM_COUNT }, (_, i) => i),
    });
  }, 30000);
});
