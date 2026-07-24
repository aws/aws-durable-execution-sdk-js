import {
  DagResultImpl,
  createDagResultSerdes,
  restoreDagResult,
  buildDagSummaryEnvelope,
  defaultDagSummaryGenerator,
} from "./dag-result";
import { TaskExecution } from "../../types/dag";
import {
  StepError,
  DagExecutionError,
} from "../../errors/durable-error/durable-error";
import { BatchResultImpl } from "../concurrent-execution-handler/batch-result";
import { BatchItemStatus } from "../../types/batch";
import { SerdesContext } from "../../utils/serdes/serdes";

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

describe("buildDagSummaryEnvelope", () => {
  it("produces SDK-owned fields and quarantines customer text", () => {
    const r = new DagResultImpl(
      results([
        { name: "a", status: "SUCCEEDED", result: 1 },
        { name: "b", status: "STARTED" },
      ]),
      "MIN_SUCCESSFUL_REACHED",
    );
    const env = buildDagSummaryEnvelope(r, () => "custom text");
    expect(env.type).toBe("DagResult");
    expect(env.successCount).toBe(1);
    expect(env.startedTaskNames).toEqual(["b"]);
    expect(env.terminalTaskNames).toEqual(["a"]);
    expect(env.summary).toBe("custom text");
  });

  it("defaultDagSummaryGenerator is descriptive", () => {
    const r = new DagResultImpl(
      results([{ name: "a", status: "SUCCEEDED", result: 1 }]),
      "ALL_COMPLETED",
    );
    expect(defaultDagSummaryGenerator(r)).toContain("succeeded");
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
