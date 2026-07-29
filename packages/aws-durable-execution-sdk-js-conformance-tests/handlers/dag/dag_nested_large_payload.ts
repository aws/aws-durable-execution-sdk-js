// 10-17: nested-DAG large-payload offload survives a completed-container replay.
//
// The untested intersection of NESTING and LARGE PAYLOADS. The outer DAG
// `outernested` (maxConcurrency 1) has a single nested `dag` task `inner`
// (maxConcurrency 1) whose six step tasks p1..p6 each return one distinct letter
// repeated 51200 times (p1 = "a"×51200 .. p6 = "f"×51200). Six × 51200 ≈ 307KB
// — comfortably over the 256KB checkpoint limit — so the INNER aggregate is
// OFFLOADED. And because the outer embeds the inner tasks in full, the OUTER is
// over the limit too, so BOTH containers offload. That is exactly the
// combination the nested-offload contract targets.
//
// Modeled on 10-15: the `wait` sits OUTSIDE the outer DAG so the DAG completes
// in the first invocation, and the NEXT invocation replays BOTH completed
// containers. The outer container is reconstructed from its SDK envelope +
// child checkpoints; reconstructing the inner `dag` task recurses into the inner
// container's OWN child checkpoints (contract rule 2) to rebuild the inner
// per-task detail. `digestBefore` is checkpointed as a step so it survives the
// suspend (the pre-replay, live digest); `digestAfter` is recomputed after the
// resume from the REPLAYED inner DagResult.
//
// The decisive assertion is digestBefore == digestAfter == "6:307200:abcdef":
// that proves the inner per-task detail survived the offload of BOTH containers.
// Under the bug the inner comes back EMPTY, so the after-digest differs, while
// `innerReason` would still read a fabricated ALL_COMPLETED — which is exactly
// why the digest, not the reason, is the decisive check.
//
// Outcome-only (no ExpectedExecutionHistory): the containers' ContextSucceeded
// payloads legitimately differ across SDKs (a DagSummary envelope in JS vs. an
// offloaded aggregate marked ReplayChildren elsewhere). No completionConfig: all
// six inner tasks complete. Only the compact digest is returned, never a payload.
import {
  DurableContext,
  withDurableExecution,
  type DagResult,
} from "@aws/durable-execution-sdk-js";

const PER_TASK_SIZE = 51200;
const INNER_TASK_NAMES = ["p1", "p2", "p3", "p4", "p5", "p6"] as const;

// Language-neutral digest of the inner DagResult: "<innerTaskCount>:<totalLength
// of all inner results>:<first char of each inner result, in task order>". For
// this graph it is exactly "6:307200:abcdef".
const digestOfInner = (inner: DagResult): string => {
  let totalLength = 0;
  let firstChars = "";
  for (const name of INNER_TASK_NAMES) {
    const value = inner.getResult(name) as string;
    totalLength += value.length;
    firstChars += value.charAt(0);
  }
  return `${inner.totalCount}:${totalLength}:${firstChars}`;
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag(
      "outernested",
      (d) => {
        // A single nested `dag` task whose own aggregate exceeds the limit.
        d.dag(
          "inner",
          [],
          (nd) => {
            INNER_TASK_NAMES.forEach((name, i) => {
              // p1 => "a"×51200, p2 => "b"×51200, ... p6 => "f"×51200.
              const letter = String.fromCharCode("a".charCodeAt(0) + i);
              nd.step(
                name,
                [],
                async (): Promise<string> => letter.repeat(PER_TASK_SIZE),
              );
            });
          },
          { maxConcurrency: 1 },
        );
      },
      { maxConcurrency: 1 },
    );

    // Digest of the PRE-suspend (live) inner aggregate, captured as a STEP so it
    // is checkpointed and survives the suspend unchanged.
    const digestBefore = await context.step(
      "digestBefore",
      async (): Promise<string> =>
        digestOfInner(result.getResult("inner") as DagResult),
    );

    // Force the invocation to end and the next one to replay BOTH completed
    // containers (outer + inner).
    await context.wait("settle", { seconds: 2 });

    // After the resume, `result` is the REPLAYED outer DagResult and
    // `result.getResult("inner")` is the inner DagResult reconstructed by
    // recursing into the inner container's own child checkpoints. Recompute the
    // identical digest from it.
    const innerAfter = result.getResult("inner") as DagResult;
    const digestAfter = digestOfInner(innerAfter);

    return {
      reason: result.completionReason,
      innerReason: innerAfter.completionReason,
      // [total, failed, skipped, succeeded]
      innerCounts: [
        innerAfter.totalCount,
        innerAfter.failureCount,
        innerAfter.skippedCount,
        innerAfter.successCount,
      ],
      digestBefore,
      digestAfter,
      match: digestBefore === digestAfter,
    };
  },
);
