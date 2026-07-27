import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Map Custom Summary Generator Replay",
  description:
    "A summarized map (aggregate result over the 256KB checkpoint limit) that " +
    "completes early via minSuccessful, using a custom summaryGenerator whose " +
    "output is a free-form string with no numeric totalCount. After a " +
    "suspend/resume the summarized map is replayed. Reproduces issue #751: a " +
    "custom summaryGenerator without the fields replay depends on must not hang " +
    "the replay.",
};

/**
 * Default per-item payload (~150KB). Two successes (minSuccessful: 2) push the
 * aggregate BatchResult past the 256KB checkpoint limit, which triggers
 * ReplayChildren mode — the only path where summaryGenerator is used and where
 * the batch is reconstructed from child checkpoints on replay. Tests can pass a
 * small size to stay within a single checkpoint (no summarized replay).
 */
const DEFAULT_ITEM_PAYLOAD_SIZE = 150 * 1024;

/**
 * Prefix of the custom (free-form, non-JSON) summary, so the test can prove the
 * user-provided generator was used.
 */
export const CUSTOM_SUMMARY_PREFIX = "processed";

interface Event {
  itemPayloadSize?: number;
}

export const handler = withDurableExecution(
  async (event: Event | undefined, context: DurableContext) => {
    const itemPayloadSize = event?.itemPayloadSize ?? DEFAULT_ITEM_PAYLOAD_SIZE;

    const result = await context.map(
      "summarized-map",
      [0, 1, 2, 3, 4],
      async (_ctx, _item, index) => {
        // With maxConcurrency: 2, items 0 and 1 start first. Item 1 is slow, so
        // item 0 finishes and frees a slot for item 2, which also finishes —
        // reaching minSuccessful: 2 (items 0 and 2) while item 1 is still in
        // flight. The in-flight item therefore sits BETWEEN two completed items
        // (child step ids: item0=SUCCEEDED, item1=STARTED, item2=SUCCEEDED),
        // which is the exact shape that hangs replay on an unpatched SDK.
        //
        // NOTE: item 1's delay is NEVER actually waited. minSuccessful completes
        // the batch (via items 0 and 2) and abandons this in-flight item, so the
        // execution suspends at the `after-map` wait below and finishes in a few
        // seconds — not 60s. The timer is `unref`'d so it never keeps the
        // process alive, and a plain setTimeout (not ctx.wait) is used on
        // purpose: an abandoned *durable* wait makes the local runner block on
        // its timer. Keep this delay LARGE — it only has to outlast the test
        // window. Do NOT shorten it: a short delay can fire mid-test, flip
        // item 1 to SUCCEEDED, and silently break the STARTED-in-the-middle
        // shape this repro depends on.
        if (index === 1) {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 60_000);
            // Don't let this abandoned timer keep the Node process alive.
            (timer as unknown as { unref?: () => void }).unref?.();
          });
        }
        return "x".repeat(itemPayloadSize);
      },
      {
        maxConcurrency: 2,
        completionConfig: { minSuccessful: 2 },
        itemNamer: (_item: number, index: number) => `item-${index}`,
        // Free-form summary WITHOUT a numeric totalCount field. The developer
        // guide calls this payload "for observability only", yet replay depends
        // on it — the crux of issue #751.
        summaryGenerator: (r) =>
          `${CUSTOM_SUMMARY_PREFIX} ${r.successCount}/${r.totalCount} items`,
      },
    );

    // Snapshot the aggregate the running code observed.
    const snapshot = {
      totalCount: result.totalCount,
      successCount: result.successCount,
      startedCount: result.startedCount,
      completionReason: result.completionReason,
      itemIndexes: result.all.map((item) => item.index),
    };

    // Suspend, then resume: on resume the summarized map is replayed. On an
    // unpatched SDK the replay of a free-form-summary batch falls back to
    // concurrent execution in ReplaySucceededContext mode, where the in-flight
    // child yields a never-resolving promise and the invocation hangs.
    await context.wait("after-map", { seconds: 1 });

    return snapshot;
  },
);
