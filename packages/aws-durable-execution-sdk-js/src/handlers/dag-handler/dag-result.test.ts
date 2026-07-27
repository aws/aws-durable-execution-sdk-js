import {
  DagResultImpl,
  createDagResultSerdes,
  restoreDagResult,
  buildDagOffloadPayload,
} from "./dag-result";
import { DagResultEnvelope, TaskExecution } from "../../types/dag";
import {
  StepError,
  DagExecutionError,
} from "../../errors/durable-error/durable-error";
import { BatchResultImpl } from "../concurrent-execution-handler/batch-result";
import { BatchItemStatus } from "../../types/batch";
import { SerdesContext } from "../../utils/serdes/serdes";
import { CHECKPOINT_SIZE_LIMIT_BYTES } from "../../utils/constants/constants";

const ctx: SerdesContext = {
  entityId: "1-2",
  durableExecutionArn: "arn:test",
};

const results = (entries: TaskExecution[]): Map<string, TaskExecution> =>
  new Map(entries.map((e) => [e.name, e]));

describe("DagResultImpl", () => {
  it("computes counts and resolves results/status", () => {
    const r = new DagResultImpl(
      results([
        { name: "a", status: "SUCCEEDED", result: 1 },
        { name: "b", status: "FAILED", error: new StepError("boom") },
        { name: "c", status: "SKIPPED", skipReason: "TRIGGER_RULE" },
      ]),
      "COMPLETED_WITH_FAILURES",
    );
    expect(r.successCount).toBe(1);
    expect(r.failureCount).toBe(1);
    expect(r.skippedCount).toBe(1);
    expect(r.totalCount).toBe(3);
    expect(r.getResult("a")).toBe(1);
    expect(r.getResult("b")).toBeUndefined();
    expect(r.getStatus("c")).toBe("SKIPPED");
    expect(r.getStatus("missing")).toBeUndefined();
    expect(r.succeeded().map((e) => e.name)).toEqual(["a"]);
    expect(r.failed().map((e) => e.name)).toEqual(["b"]);
    expect(r.skipped().map((e) => e.name)).toEqual(["c"]);
  });

  it("throwIfError throws DagExecutionError when failures exist", () => {
    const r = new DagResultImpl(
      results([{ name: "b", status: "FAILED", error: new StepError("boom") }]),
      "COMPLETED_WITH_FAILURES",
    );
    expect(() => r.throwIfError()).toThrow(DagExecutionError);
  });

  it("throwIfError throws on CUSTOM_COMPLETION_FAILED with no failed task", () => {
    const r = new DagResultImpl(
      results([{ name: "a", status: "SUCCEEDED", result: 1 }]),
      "CUSTOM_COMPLETION_FAILED",
    );
    expect(() => r.throwIfError()).toThrow(DagExecutionError);
  });

  it("throwIfError does not throw on a clean run", () => {
    const r = new DagResultImpl(
      results([{ name: "a", status: "SUCCEEDED", result: 1 }]),
      "ALL_COMPLETED",
    );
    expect(() => r.throwIfError()).not.toThrow();
  });
});

describe("createDagResultSerdes", () => {
  it("round-trips plain results, errors, and skips", async () => {
    const serdes = createDagResultSerdes();
    const original = new DagResultImpl(
      results([
        { name: "a", status: "SUCCEEDED", result: { v: 42 } },
        { name: "b", status: "FAILED", error: new StepError("boom") },
        { name: "c", status: "SKIPPED", skipReason: "RUN_IF_PREDICATE" },
      ]),
      "COMPLETED_WITH_FAILURES",
    );
    const str = await serdes.serialize(original, ctx);
    const restored = (await serdes.deserialize(str, ctx))!;
    expect(restored.completionReason).toBe("COMPLETED_WITH_FAILURES");
    expect(restored.getResult("a")).toEqual({ v: 42 });
    expect(restored.getStatus("c")).toBe("SKIPPED");
    const failed = restored.failed();
    expect(failed[0].error).toBeInstanceOf(StepError);
  });

  it("restores a batch (map/parallel) task result to a methoded BatchResult", async () => {
    const serdes = createDagResultSerdes();
    const batch = new BatchResultImpl(
      [{ index: 0, status: BatchItemStatus.SUCCEEDED, result: "x" }],
      "ALL_COMPLETED",
    );
    const original = new DagResultImpl(
      results([{ name: "m", status: "SUCCEEDED", result: batch }]),
      "ALL_COMPLETED",
    );
    const str = await serdes.serialize(original, ctx);
    const restored = (await serdes.deserialize(str, ctx))!;
    const restoredBatch = restored.getResult("m") as BatchResultImpl<string>;
    expect(typeof restoredBatch.getResults).toBe("function");
    expect(restoredBatch.getResults()).toEqual(["x"]);
  });

  it("recursively restores a nested DagResult task result (resultKind dag)", async () => {
    const serdes = createDagResultSerdes();
    const inner = new DagResultImpl(
      results([{ name: "y", status: "SUCCEEDED", result: 99 }]),
      "ALL_COMPLETED",
      1,
    );
    const original = new DagResultImpl(
      results([{ name: "inner", status: "SUCCEEDED", result: inner }]),
      "ALL_COMPLETED",
      1,
    );
    const str = await serdes.serialize(original, ctx);
    const restored = (await serdes.deserialize(str, ctx))!;
    const restoredInner = restored.getResult("inner") as DagResultImpl;
    expect(typeof restoredInner.getResult).toBe("function");
    expect(restoredInner.getResult("y")).toBe(99);
  });
});

describe("converged DagResultEnvelope (inline)", () => {
  it("serializes one envelope shape with explicit nulls and aggregate fields", async () => {
    const serdes = createDagResultSerdes();
    const original = new DagResultImpl(
      results([
        {
          name: "a",
          status: "SUCCEEDED",
          result: 1,
          startedAt: new Date("2026-07-26T03:19:01.884Z"),
          completedAt: new Date("2026-07-26T03:19:01.885Z"),
        },
        { name: "b", status: "FAILED", error: new StepError("boom") },
        { name: "c", status: "SKIPPED", skipReason: "TRIGGER_RULE" },
      ]),
      "COMPLETED_WITH_FAILURES",
    );
    const env = JSON.parse((await serdes.serialize(original, ctx))!);

    // Aggregate fields are always present, even alongside `tasks`.
    expect(env.type).toBe("DagResult");
    expect(env.totalCount).toBe(3);
    expect(env.successCount).toBe(1);
    expect(env.failureCount).toBe(1);
    expect(env.skippedCount).toBe(1);
    expect(env.completionReason).toBe("COMPLETED_WITH_FAILURES");
    expect(env.startedTaskNames).toEqual([]);
    expect(env.failedTaskNames).toEqual(["b"]);
    expect(Array.isArray(env.tasks)).toBe(true);

    // Every canonical task field is present; unset values are explicit null.
    const [a, b, c] = env.tasks;
    expect(a).toEqual({
      name: "a",
      status: "SUCCEEDED",
      skipReason: null,
      resultKind: "plain",
      result: 1,
      error: null,
      startedAt: "2026-07-26T03:19:01.884Z",
      completedAt: "2026-07-26T03:19:01.885Z",
    });
    expect(b.status).toBe("FAILED");
    expect(b.skipReason).toBeNull();
    expect(b.resultKind).toBeNull();
    expect(b.result).toBeNull();
    expect(b.error).not.toBeNull();
    expect(b.error.ErrorMessage).toBe("boom"); // PascalCase error object
    expect(c).toEqual({
      name: "c",
      status: "SKIPPED",
      skipReason: "TRIGGER_RULE",
      resultKind: null,
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
    });
  });

  it("deserializes ignoring unknown extra fields (contract rule 4)", async () => {
    const serdes = createDagResultSerdes();
    const original = new DagResultImpl(
      results([{ name: "a", status: "SUCCEEDED", result: 7 }]),
      "ALL_COMPLETED",
    );
    const env = JSON.parse((await serdes.serialize(original, ctx))!);
    // Inject a field a future SDK version might add.
    env.unknownFutureField = { nested: true };
    env.tasks[0].alsoUnknown = 123;
    const restored = restoreDagResult(env);
    expect(restored.getResult("a")).toBe(7);
    expect(restored.successCount).toBe(1);
  });
});

describe("buildDagOffloadPayload (offloaded / tasks-dropped)", () => {
  const started = new DagResultImpl(
    results([
      { name: "a", status: "SUCCEEDED", result: 1 },
      { name: "b", status: "FAILED", error: new StepError("boom") },
      { name: "c", status: "STARTED" },
    ]),
    "MIN_SUCCESSFUL_REACHED",
  );

  it("emits the SAME envelope as inline but WITHOUT tasks", () => {
    const env: DagResultEnvelope = JSON.parse(buildDagOffloadPayload(started));
    expect(env.type).toBe("DagResult");
    expect("tasks" in env).toBe(false); // absence is the offload signal
    expect(env.totalCount).toBe(3);
    expect(env.successCount).toBe(1);
    expect(env.failureCount).toBe(1);
    expect(env.skippedCount).toBe(0);
    expect(env.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
    expect(env.startedTaskNames).toEqual(["c"]);
    expect(env.failedTaskNames).toEqual(["b"]);
  });

  it("degradation ladder: drops failedTaskNames when still too large, never the started set/counts", () => {
    // Force step 3 by making failedTaskNames alone exceed the size limit.
    const manyFailures: TaskExecution[] = [];
    const failName = (i: number): string => `fail_${"x".repeat(200)}_${i}`;
    const count = Math.ceil(CHECKPOINT_SIZE_LIMIT_BYTES / 210) + 10;
    for (let i = 0; i < count; i++) {
      manyFailures.push({
        name: failName(i),
        status: "FAILED",
        error: new StepError("e"),
      });
    }
    manyFailures.push({ name: "running", status: "STARTED" });
    const big = new DagResultImpl(
      new Map(manyFailures.map((e) => [e.name, e])),
      "COMPLETED_WITH_FAILURES",
    );
    const env: DagResultEnvelope = JSON.parse(buildDagOffloadPayload(big));
    // failedTaskNames dropped to null; started set + counts + reason survive.
    expect(env.failedTaskNames).toBeNull();
    expect(env.startedTaskNames).toEqual(["running"]);
    expect(env.failureCount).toBe(count);
    expect(env.completionReason).toBe("COMPLETED_WITH_FAILURES");
    expect("tasks" in env).toBe(false);
  });
});

describe("restoreDagResult", () => {
  it("returns a DagResultImpl unchanged", () => {
    const r = new DagResultImpl(new Map(), "ALL_COMPLETED", 0);
    expect(restoreDagResult(r)).toBe(r);
  });

  it("handles malformed data gracefully", () => {
    const r = restoreDagResult({ nonsense: true });
    expect(r.totalCount).toBe(0);
  });
});
