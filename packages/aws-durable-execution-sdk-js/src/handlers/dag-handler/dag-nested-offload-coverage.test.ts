/**
 * Nested-DAG large-payload offload coverage (TypeScript).
 *
 * The untested intersection of NESTING and LARGE PAYLOADS (nested-offload
 * contract). A nested DAG is both a task of the outer DAG and a child CONTAINER
 * in its own right, so it checkpoints its own envelope under the same branch
 * rule, and the outer envelope embeds the inner result recursively. When the
 * inner aggregate exceeds the 256KB checkpoint limit, the inner container is
 * OFFLOADED (its envelope carries no `tasks`); and because the outer embeds the
 * inner tasks in full, the outer is over the limit too — so BOTH containers
 * offload. This is exactly the combination that used to hit the fabricating
 * fallthrough in `restoreDagResult`.
 *
 * The graph mirrors the `10-17 DagNestedLargePayload` conformance scenario:
 * outer `outernested` (maxConcurrency 1) with a single nested `dag` task
 * `inner` (maxConcurrency 1) whose six step tasks p1..p6 each return a distinct
 * letter × 51200 (~307KB aggregate, over the limit).
 *
 * These tests drive the real container-replay seam: rebuild the operations the
 * SDK would have checkpointed for a completed, doubly-offloaded run — the outer
 * container carrying the tasks-less outer envelope + `ReplayChildren`, the inner
 * container carrying the tasks-less inner envelope + `ReplayChildren`, and one
 * SUCCEEDED Step per inner task — then replay the same graph in
 * `ReplaySucceededContext` mode. This routes the outer through
 * `reconstructDagResult`, which recurses into the inner container's OWN child
 * checkpoints (rule 2) to rebuild the inner per-task detail.
 */
import {
  Operation,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { createTestDurableContext } from "../../testing/create-test-durable-context";
import { buildDagOffloadPayload, createDagResultSerdes } from "./dag-result";
import { DagContext, DagResult, DagResultEnvelope } from "../../types/dag";
import { DurableExecutionMode, OperationSubType } from "../../types/core";
import { CHECKPOINT_SIZE_LIMIT_BYTES } from "../../utils/constants/constants";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

const PER_TASK_SIZE = 51200;
const INNER_TASKS = ["p1", "p2", "p3", "p4", "p5", "p6"] as const;
const letterOf = (i: number): string =>
  String.fromCharCode("a".charCodeAt(0) + i);
const payloadOf = (i: number): string => letterOf(i).repeat(PER_TASK_SIZE);

// Inner `dag` registration. Optional per-task counters let a test observe how
// many times each inner task BODY runs (vs. being replayed from a checkpoint).
const buildInnerGraph =
  (counters?: Record<string, number>) =>
  (nd: DagContext): void => {
    INNER_TASKS.forEach((name, i) => {
      nd.step(name, [], async (): Promise<string> => {
        if (counters) {
          counters[name] = (counters[name] ?? 0) + 1;
        }
        return payloadOf(i);
      });
    });
  };

// Outer `dag`: a single nested `dag` task `inner`.
const buildOuterGraph =
  (counters?: Record<string, number>) =>
  (d: DagContext): void => {
    d.dag("inner", [], buildInnerGraph(counters), { maxConcurrency: 1 });
  };

const serdesCtx = { entityId: "1", durableExecutionArn: "arn:test" };

// Root context: the outer DAG is the first (and only) durable op in the replay
// invocation, so with an unprefixed root its container id is "1", the nested
// task's container id is `1-DAG_NODE_T_inner`, and each inner task's id is
// `1-DAG_NODE_T_inner-DAG_NODE_T_<name>` (createStepId / createTaskId).
const OUTER_ID = "1";
const INNER_ID = `${OUTER_ID}-DAG_NODE_T_inner`;
const innerTaskId = (name: string): string => `${INNER_ID}-DAG_NODE_T_${name}`;

const contextOp = (
  rawId: string,
  name: string,
  envelope: DagResultEnvelope,
): Operation =>
  ({
    Id: hashId(rawId),
    Type: OperationType.CONTEXT,
    Status: OperationStatus.SUCCEEDED,
    Name: name,
    SubType: OperationSubType.DAG,
    StartTimestamp: new Date(),
    ContextDetails: {
      Result: JSON.stringify(envelope),
      ReplayChildren: true,
    },
  }) as unknown as Operation;

/**
 * Rebuilds the operations the SDK would have checkpointed for a completed,
 * doubly-offloaded run: the outer container (tasks-less outer envelope,
 * ReplayChildren), the inner container (tasks-less inner envelope,
 * ReplayChildren), and one SUCCEEDED Step per inner task.
 */
const buildReplayOperations = (
  outerEnvelope: DagResultEnvelope,
  innerEnvelope: DagResultEnvelope,
  innerTaskPayloads: Record<string, string>,
): Operation[] => {
  const ops: Operation[] = [
    contextOp(OUTER_ID, "outernested", outerEnvelope),
    contextOp(INNER_ID, "inner", innerEnvelope),
  ];
  for (const name of INNER_TASKS) {
    ops.push({
      Id: hashId(innerTaskId(name)),
      Type: OperationType.STEP,
      Status: OperationStatus.SUCCEEDED,
      Name: name,
      SubType: OperationSubType.STEP,
      StartTimestamp: new Date(),
      StepDetails: { Result: innerTaskPayloads[name] },
    } as unknown as Operation);
  }
  return ops;
};

const runLive = async (
  counters?: Record<string, number>,
): Promise<DagResult> => {
  const { context } = createTestDurableContext();
  return context.dag("outernested", buildOuterGraph(counters), {
    maxConcurrency: 1,
  });
};

const runReplay = async (
  outerEnvelope: DagResultEnvelope,
  innerEnvelope: DagResultEnvelope,
  innerTaskPayloads: Record<string, string>,
  counters?: Record<string, number>,
): Promise<DagResult> => {
  const { context } = createTestDurableContext({
    durableExecutionMode: DurableExecutionMode.ReplaySucceededContext,
    existingOperations: buildReplayOperations(
      outerEnvelope,
      innerEnvelope,
      innerTaskPayloads,
    ),
  });
  return context.dag("outernested", buildOuterGraph(counters), {
    maxConcurrency: 1,
  });
};

const innerPayloadsFrom = (inner: DagResult): Record<string, string> => {
  const payloads: Record<string, string> = {};
  for (const name of INNER_TASKS) {
    // A Step checkpoints its result via the default (JSON) serdes.
    payloads[name] = JSON.stringify(inner.getResult(name));
  }
  return payloads;
};

describe("DAG nested large-payload offload coverage (TypeScript)", () => {
  it("both inner AND outer aggregates exceed the checkpoint limit (both offload)", async () => {
    const outer = await runLive();
    const inner = outer.getResult("inner") as DagResult;

    const serdes = createDagResultSerdes();
    const innerBytes = Buffer.byteLength(
      (await serdes.serialize(inner, serdesCtx))!,
      "utf8",
    );
    const outerBytes = Buffer.byteLength(
      (await serdes.serialize(outer, serdesCtx))!,
      "utf8",
    );
    // The inner aggregate (~307KB) is over the limit, and because the outer
    // embeds the inner tasks in full the outer is over it too.
    expect(innerBytes).toBeGreaterThan(CHECKPOINT_SIZE_LIMIT_BYTES);
    expect(outerBytes).toBeGreaterThan(CHECKPOINT_SIZE_LIMIT_BYTES);

    // Both offloaded envelopes are tiny and carry NO tasks (the offload signal).
    const outerEnvelope: DagResultEnvelope = JSON.parse(
      buildDagOffloadPayload(outer),
    );
    const innerEnvelope: DagResultEnvelope = JSON.parse(
      buildDagOffloadPayload(inner),
    );
    expect("tasks" in outerEnvelope).toBe(false);
    expect("tasks" in innerEnvelope).toBe(false);
    expect(
      Buffer.byteLength(JSON.stringify(innerEnvelope), "utf8"),
    ).toBeLessThan(CHECKPOINT_SIZE_LIMIT_BYTES);
  });

  it("recovers full inner per-task detail after BOTH containers replay (rule 2)", async () => {
    const outer = await runLive();
    const inner = outer.getResult("inner") as DagResult;
    const outerEnvelope: DagResultEnvelope = JSON.parse(
      buildDagOffloadPayload(outer),
    );
    const innerEnvelope: DagResultEnvelope = JSON.parse(
      buildDagOffloadPayload(inner),
    );

    const outerReplay = await runReplay(
      outerEnvelope,
      innerEnvelope,
      innerPayloadsFrom(inner),
    );

    // Outer aggregate survives.
    expect(outerReplay.completionReason).toBe("ALL_COMPLETED");
    expect(outerReplay.getStatus("inner")).toBe("SUCCEEDED");

    // The inner DagResult, reconstructed by recursing into the inner
    // container's OWN child checkpoints, reports the correct aggregate...
    const innerReplay = outerReplay.getResult("inner") as DagResult;
    expect(innerReplay.completionReason).toBe("ALL_COMPLETED");
    expect([
      innerReplay.successCount,
      innerReplay.failureCount,
      innerReplay.skippedCount,
      innerReplay.totalCount,
    ]).toEqual([6, 0, 0, 6]);

    // ...AND full per-task detail — this is what the offload of BOTH
    // containers used to destroy. Check a full 51200-char value byte-for-byte.
    for (const name of INNER_TASKS) {
      expect(innerReplay.getStatus(name)).toBe("SUCCEEDED");
      expect(innerReplay.getResult(name)).toBe(inner.getResult(name));
    }
    const p4 = innerReplay.getResult("p4") as string;
    expect(p4).toBe("d".repeat(PER_TASK_SIZE));
    expect(p4.length).toBe(PER_TASK_SIZE);
  });

  it("preserves the inner aggregate even when the inner register is not re-run (rule 1 fallback)", async () => {
    // Sanity guard for rule 1 in isolation: a tasks-less inner envelope that
    // reports failures must NEVER come back as fabricated ALL_COMPLETED.
    const inner = (await runLive()).getResult("inner") as DagResult;
    const innerEnvelope: DagResultEnvelope = JSON.parse(
      buildDagOffloadPayload(inner),
    );
    const failing: DagResultEnvelope = {
      ...innerEnvelope,
      successCount: 4,
      failureCount: 2,
      skippedCount: 0,
      totalCount: 6,
      completionReason: "COMPLETED_WITH_FAILURES",
    };
    const restored = (await createDagResultSerdes().deserialize(
      JSON.stringify(failing),
      serdesCtx,
    ))!;
    expect(restored.completionReason).toBe("COMPLETED_WITH_FAILURES");
    expect(restored.failureCount).toBe(2);
    expect(restored.totalCount).toBe(6);
  });

  it("inner task bodies run exactly once across the offload and the replay", async () => {
    // External per-task counters. Nesting DOUBLES the number of containers that
    // replay, so this guards against a nested body re-running (a customer side
    // effect firing twice).
    const counters: Record<string, number> = {};

    // Live: each inner body runs exactly once under the scheduler.
    const outer = await runLive(counters);
    const inner = outer.getResult("inner") as DagResult;
    for (const name of INNER_TASKS) {
      expect(counters[name]).toBe(1);
    }

    // Replay of BOTH completed containers: the reconstruct path reads inner
    // per-task results from checkpoints and MUST NOT re-invoke any body.
    const outerEnvelope: DagResultEnvelope = JSON.parse(
      buildDagOffloadPayload(outer),
    );
    const innerEnvelope: DagResultEnvelope = JSON.parse(
      buildDagOffloadPayload(inner),
    );
    const outerReplay = await runReplay(
      outerEnvelope,
      innerEnvelope,
      innerPayloadsFrom(inner),
      counters,
    );

    for (const name of INNER_TASKS) {
      expect(counters[name]).toBe(1);
    }
    const innerReplay = outerReplay.getResult("inner") as DagResult;
    for (const name of INNER_TASKS) {
      expect(innerReplay.getResult(name)).toBe(inner.getResult(name));
    }
  });
});
