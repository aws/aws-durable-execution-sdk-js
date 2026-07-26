// 10-15: DAG large-payload offload survives a completed-container replay.
//
// Eight root step tasks p1..p8 each return a 51200-char string of their own
// letter (p1 = "a"×51200 .. p8 = "h"×51200). The aggregate DagResult is ~410KB
// — comfortably over the 256KB checkpoint limit — so the DAG container's result
// is OFFLOADED when it is checkpointed. Every individual task result stays well
// under the limit, so only the aggregate is offloaded.
//
// Offload alone does not exercise the interesting path: the reconstruct-vs-
// re-execute divergence only fires when a SUCCEEDED CONTAINER IS REPLAYED. So
// after the DAG resolves we compute a digest of the aggregate in a (checkpointed)
// step, then `wait` 2 seconds — which ends the invocation — and the NEXT
// invocation replays the completed container. JS reconstructs the aggregate from
// its SDK-owned DagSummary envelope + the per-task checkpoints; Python/Java/Go
// re-execute the DAG child body via ReplayChildren. This scenario asserts a
// single language-neutral fact: the digest computed before the suspend equals
// the digest recomputed from the replayed DagResult afterwards — i.e. the
// aggregate survived the offload and came back identical through whichever
// strategy the SDK uses.
//
// Outcome-only (no ExpectedExecutionHistory): the container's ContextSucceeded
// payload legitimately differs across SDKs (a DagSummary envelope in JS vs. an
// offloaded aggregate marked ReplayChildren elsewhere), so pinning it would
// encode the divergence as a requirement. No completionConfig: all eight tasks
// complete, avoiding Python's documented large-payload early-completion
// STARTED-set exception. Only the compact digest is returned, never the payload.
import {
  DurableContext,
  withDurableExecution,
  type DagResult,
} from "@aws/durable-execution-sdk-js";

const PER_TASK_SIZE = 51200;
const TASK_NAMES = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"] as const;

// Language-neutral digest of a DagResult: "<taskCount>:<totalLength>:<firstChar
// of each task in order>". For the 10-15 graph this is exactly "8:409600:abcdefgh".
const digestOf = (result: DagResult): string => {
  let totalLength = 0;
  let firstChars = "";
  for (const name of TASK_NAMES) {
    const value = result.getResult(name) as string;
    totalLength += value.length;
    firstChars += value.charAt(0);
  }
  return `${result.totalCount}:${totalLength}:${firstChars}`;
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag(
      "bigdag",
      (d) => {
        TASK_NAMES.forEach((name, i) => {
          // p1 => "a"×51200, p2 => "b"×51200, ... p8 => "h"×51200.
          const letter = String.fromCharCode("a".charCodeAt(0) + i);
          d.step(
            name,
            [],
            async (): Promise<string> => letter.repeat(PER_TASK_SIZE),
          );
        });
      },
      { maxConcurrency: 1 },
    );

    // Computed as a STEP so it is checkpointed and survives the suspend — this
    // is the digest of the pre-suspend (live) aggregate.
    const digestBefore = await context.step(
      "digestBefore",
      async (): Promise<string> => digestOf(result),
    );

    // The whole point: force the invocation to end and the next one to replay
    // the completed DAG container.
    await context.wait({ seconds: 2 });

    // After the resume, `result` is the REPLAYED DagResult (reconstructed from
    // the envelope in JS; re-executed child body elsewhere). Recompute the same
    // digest from it.
    const digestAfter = digestOf(result);

    return {
      reason: result.completionReason,
      counts: [
        result.successCount,
        result.failureCount,
        result.skippedCount,
        result.totalCount,
      ],
      digestBefore,
      digestAfter,
      match: digestBefore === digestAfter,
    };
  },
);
