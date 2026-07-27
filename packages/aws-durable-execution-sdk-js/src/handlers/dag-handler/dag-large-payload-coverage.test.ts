/**
 * Large-payload coverage integration tests (TypeScript).
 *
 * Closes the last DAG conformance gap locally. A DAG whose aggregate result
 * exceeds the 256KB checkpoint limit is OFFLOADED when the container is
 * checkpointed, and the reconstruct-vs-re-execute divergence only fires when a
 * SUCCEEDED CONTAINER IS REPLAYED. These tests mirror the `10-15` handler graph
 * exactly (DAG name `bigdag`, tasks p1..p8, each returning its own letter ×
 * 51200) and force a replay of the completed container by:
 *
 *   1. running the DAG live (ExecutionMode) — the real offload branch in
 *      `executeChildContext` fires here (serialized aggregate over 256KB), and we
 *      independently assert the aggregate exceeds the limit so the scenario is
 *      provably testing what it claims;
 *   2. rebuilding the exact operations the SDK would have checkpointed — the
 *      converged {@link DagResultEnvelope} (with `tasks` dropped) under the DAG
 *      container (marked `ReplayChildren`) plus each per-task Step checkpoint —
 *      and replaying the same graph in `ReplaySucceededContext` mode, which
 *      routes through `handleCompletedChildContext` into the DAG body's
 *      `readDagEnvelope` / `reconstructDagResult` seam.
 *
 * Three tests: (1) aggregate fidelity across the replay, byte-identical per-task
 * results including a full 51200-char value; (2) task bodies invoked exactly
 * once across the offload and the replay (external counters); (3) the same,
 * asserted through the real container-replay seam.
 */
import {
  Operation,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { createTestDurableContext } from "../../testing/create-test-durable-context";
import { buildDagOffloadPayload, createDagResultSerdes } from "./dag-result";
import { DagConfig, DagResult, DagResultEnvelope } from "../../types/dag";
import { DurableExecutionMode, OperationSubType } from "../../types/core";
import { CHECKPOINT_SIZE_LIMIT_BYTES } from "../../utils/constants/constants";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

const PER_TASK_SIZE = 51200;
const TASK_NAMES = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"] as const;
const letterOf = (i: number): string =>
  String.fromCharCode("a".charCodeAt(0) + i);
const payloadOf = (i: number): string => letterOf(i).repeat(PER_TASK_SIZE);

// Registration callback for the `bigdag` graph. Optional per-task counters let a
// test observe how many times each task BODY runs (as opposed to being replayed
// from a checkpoint).
const buildGraph =
  (counters?: Record<string, number>) =>
  (d: import("../../types/dag").DagContext): void => {
    TASK_NAMES.forEach((name, i) => {
      d.step(name, [], async (): Promise<string> => {
        if (counters) {
          counters[name] = (counters[name] ?? 0) + 1;
        }
        return payloadOf(i);
      });
    });
  };

const serdesCtx = { entityId: "1", durableExecutionArn: "arn:test" };

// The top-level DAG container is the first (and only) durable op in the replay
// invocation, so with an unprefixed root context its entity id is "1" and each
// task's name-based id is `1-DAG_NODE_T_<name>` (see createStepId / createTaskId).
const CONTAINER_ID = "1";
const taskId = (name: string): string => `${CONTAINER_ID}-DAG_NODE_T_${name}`;

/**
 * Rebuilds the operations the SDK would have checkpointed for a completed,
 * offloaded `bigdag` run: the container op carrying the converged envelope and
 * marked ReplayChildren, plus one SUCCEEDED Step op per task. Operations are
 * keyed by `hashId(rawId)` because that is how the runtime stores and looks them
 * up.
 */
const buildReplayOperations = (
  envelope: DagResultEnvelope,
  taskPayloads: Record<string, string>,
): Operation[] => {
  const ops: Operation[] = [
    {
      Id: hashId(CONTAINER_ID),
      Type: OperationType.CONTEXT,
      Status: OperationStatus.SUCCEEDED,
      Name: "bigdag",
      SubType: OperationSubType.DAG,
      StartTimestamp: new Date(),
      ContextDetails: {
        Result: JSON.stringify(envelope),
        ReplayChildren: true,
      },
    } as unknown as Operation,
  ];
  for (const name of TASK_NAMES) {
    ops.push({
      Id: hashId(taskId(name)),
      Type: OperationType.STEP,
      Status: OperationStatus.SUCCEEDED,
      Name: name,
      SubType: OperationSubType.STEP,
      StartTimestamp: new Date(),
      StepDetails: { Result: taskPayloads[name] },
    } as unknown as Operation);
  }
  return ops;
};

/** Runs the `bigdag` graph live and returns the resolved (in-memory) DagResult. */
const runLive = async (
  config?: DagConfig,
  counters?: Record<string, number>,
): Promise<DagResult> => {
  const { context } = createTestDurableContext();
  return context.dag("bigdag", buildGraph(counters), {
    maxConcurrency: 1,
    ...config,
  });
};

/**
 * Replays the completed `bigdag` container from the given envelope + per-task
 * checkpoints, going through the real container-replay seam
 * (handleCompletedChildContext into reconstructDagResult).
 */
const runReplay = async (
  envelope: DagResultEnvelope,
  taskPayloads: Record<string, string>,
  counters?: Record<string, number>,
): Promise<DagResult> => {
  const { context } = createTestDurableContext({
    durableExecutionMode: DurableExecutionMode.ReplaySucceededContext,
    existingOperations: buildReplayOperations(envelope, taskPayloads),
  });
  return context.dag("bigdag", buildGraph(counters), { maxConcurrency: 1 });
};

const taskPayloadsFrom = (result: DagResult): Record<string, string> => {
  const payloads: Record<string, string> = {};
  for (const name of TASK_NAMES) {
    // A Step checkpoints its result via the default (JSON) serdes.
    payloads[name] = JSON.stringify(result.getResult(name));
  }
  return payloads;
};

describe("DAG large-payload coverage (TypeScript)", () => {
  it("offloads the aggregate (>256KB) yet keeps each task result under the limit", async () => {
    const live = await runLive();

    // The aggregate genuinely exceeds the checkpoint limit — this is what makes
    // the SDK offload the container. Serialize with the SAME serdes the SDK
    // uses so the measured size is the real one the runtime checks against.
    const serialized = (await createDagResultSerdes().serialize(
      live,
      serdesCtx,
    ))!;
    const aggregateBytes = Buffer.byteLength(serialized, "utf8");
    expect(aggregateBytes).toBeGreaterThan(CHECKPOINT_SIZE_LIMIT_BYTES);

    // Only the aggregate is offloaded: every individual task result is well
    // under the limit, so the per-task checkpoints are stored inline.
    for (const name of TASK_NAMES) {
      const bytes = Buffer.byteLength(live.getResult(name) as string, "utf8");
      expect(bytes).toBeLessThan(CHECKPOINT_SIZE_LIMIT_BYTES);
    }

    // The converged envelope that replaces the aggregate on the wire is itself
    // tiny — the whole point of the offload. It is the SAME envelope shape as
    // the inline case, only with `tasks` dropped.
    const offload = buildDagOffloadPayload(live);
    expect(Buffer.byteLength(offload, "utf8")).toBeLessThan(
      CHECKPOINT_SIZE_LIMIT_BYTES,
    );
    const envelope: DagResultEnvelope = JSON.parse(offload);
    expect(envelope.type).toBe("DagResult");
    expect("tasks" in envelope).toBe(false);
    expect(envelope.startedTaskNames).toEqual([]);
    expect(envelope.failedTaskNames).toEqual([]);
  });

  it("aggregate is byte-identical after a completed-container replay", async () => {
    const live = await runLive();
    const envelope: DagResultEnvelope = JSON.parse(
      buildDagOffloadPayload(live),
    );
    const replay = await runReplay(envelope, taskPayloadsFrom(live));

    // Outcome survives the offload and the replay.
    expect(replay.completionReason).toBe("ALL_COMPLETED");
    expect([
      replay.successCount,
      replay.failureCount,
      replay.skippedCount,
      replay.totalCount,
    ]).toEqual([8, 0, 0, 8]);

    // Every task's result is individually retrievable and byte-identical. Not
    // just a digest — check at least one FULL 51200-char value in full.
    for (let i = 0; i < TASK_NAMES.length; i++) {
      const name = TASK_NAMES[i];
      expect(replay.getStatus(name)).toBe("SUCCEEDED");
      expect(replay.getResult(name)).toBe(live.getResult(name));
    }
    const p4 = replay.getResult("p4") as string;
    expect(p4).toBe("d".repeat(PER_TASK_SIZE));
    expect(p4.length).toBe(PER_TASK_SIZE);
  });

  it("task bodies run exactly once across the offload and the replay", async () => {
    // External per-task counters. If a body runs twice, a customer side effect
    // happens twice — the bug this test exists to catch.
    const counters: Record<string, number> = {};

    // Live invocation: each body runs exactly once under the scheduler.
    const live = await runLive(undefined, counters);
    for (const name of TASK_NAMES) {
      expect(counters[name]).toBe(1);
    }

    // Replay of the completed container: JS reconstructs from the envelope +
    // per-task checkpoints and MUST NOT re-invoke any task body. Reuse the same
    // counters object across the "invocation" boundary.
    const envelope: DagResultEnvelope = JSON.parse(
      buildDagOffloadPayload(live),
    );
    const replay = await runReplay(envelope, taskPayloadsFrom(live), counters);

    // Still exactly one invocation per task after the replay.
    for (const name of TASK_NAMES) {
      expect(counters[name]).toBe(1);
      expect(replay.getResult(name)).toBe(live.getResult(name));
    }
  });
});
