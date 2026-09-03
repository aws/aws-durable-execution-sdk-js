import {
  DurableContext,
  withDurableExecution,
  NestingType,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Map Flat Summarized Replay",
  description:
    "A FLAT-nested map whose aggregate result exceeds the 256KB checkpoint " +
    "limit, so it is checkpointed as a summary (ReplayChildren) and rebuilt " +
    "from child checkpoints after a suspend/resume. Regression cover for the " +
    "rebuild dropping every item of a FLAT map: per-item contexts are virtual " +
    "and never checkpointed, so nothing identified the items that had finished " +
    "and the replayed batch came back empty even though all items succeeded. " +
    "The batch payload now records which items reached a terminal state, and " +
    "replay reads that record.",
  // The replay under test only happens if the invocation suspends, which relies
  // on the local runner's virtual clock advancing past a day-long wait. There is
  // no cloud equivalent, so this stays local rather than being deployed and
  // silently skipped.
  localOnly: true,
};

/**
 * Per-item payload. ITEM_COUNT items at this size push the aggregate
 * BatchResult past the 256KB checkpoint limit, which is what routes the map
 * into ReplayChildren mode — the only path that rebuilds the batch from child
 * checkpoints, and therefore the only path where this bug is reachable. The
 * size stays well under the per-operation payload limit so each individual
 * child checkpoint is unaffected.
 */
const ITEM_PAYLOAD_BYTES = 40 * 1024;
const ITEM_COUNT = 8;

interface ItemResult {
  item: number;
  payload: string;
}

interface Event {
  itemPayloadSize?: number;
  nesting?: NestingType;
  /**
   * When true the mapper performs NO durable operation, so a FLAT item leaves no
   * checkpoint of its own. Such an item cannot be reconstructed by probing —
   * only the per-item statuses recorded in the summary can identify it.
   */
  noDurableOperation?: boolean;
}

export const handler = withDurableExecution(
  async (event: Event | undefined, context: DurableContext) => {
    const itemPayloadSize = event?.itemPayloadSize ?? ITEM_PAYLOAD_BYTES;
    // FLAT is the case under test. The test also runs NESTED through this same
    // handler as a control, since NESTED checkpoints its item contexts and has
    // always replayed correctly.
    const nesting = event?.nesting ?? NestingType.FLAT;
    const noDurableOperation = event?.noDurableOperation ?? false;

    const items = Array.from({ length: ITEM_COUNT }, (_, i) => i);

    const batch = await context.map(
      "resolve-pages",
      items,
      async (ctx, item, index) => {
        const value = {
          item,
          payload: "x".repeat(itemPayloadSize),
        };
        // A plain mapper with no durable operation: nothing is checkpointed
        // beneath a virtual item, so there is nothing to probe on replay.
        if (noDurableOperation) {
          return value;
        }
        return ctx.step(`resolve-${index}`, () => Promise.resolve(value));
      },
      { nesting },
    );

    // Records what the LIVE run observed. On replay this step returns its
    // cached result, so the live observation survives to be compared against
    // the replayed one.
    const liveResultCount = await context.step("record-live-count", () =>
      Promise.resolve(batch.getResults().length),
    );

    // Suspension point. A wait far beyond the invocation deadline cannot be
    // resolved by in-invocation polling, so the invocation suspends and
    // everything below runs in a NEW invocation — one that replays the
    // (SUCCEEDED, ReplayChildren) map from its child checkpoints.
    await context.wait("suspend", { days: 1 });

    // Runs for the first time AFTER the resumption, so it observes the
    // REBUILT batch rather than the live one.
    const replayedResultCount = await context.step(
      "record-replayed-count",
      () => Promise.resolve(batch.getResults().length),
    );

    const replayedItems = batch.getResults().map((r) => (r as ItemResult).item);

    return { liveResultCount, replayedResultCount, replayedItems };
  },
);
