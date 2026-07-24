import { detectCycle, validateDag, validateTaskName } from "./dag-validator";
import { TaskDef } from "./task-handle";
import {
  DagCyclicDependencyError,
  DagDuplicateTaskError,
  DagInvalidDependencyError,
  DagInvalidTaskNameError,
} from "../../errors/dag-errors/dag-errors";
import { AnyTaskHandle } from "../../types/dag";

const handleOf = (def: TaskDef): AnyTaskHandle =>
  ({ name: def.name, _id: def.id }) as AnyTaskHandle;

const makeTask = (name: string, deps: TaskDef[] = []): TaskDef => ({
  name,
  id: Symbol(name),
  kind: "step",
  inlineDeps: deps.map(handleOf),
  allDeps: deps.map(handleOf),
  executor: async () => undefined,
});

describe("validateTaskName", () => {
  it("accepts valid names", () => {
    for (const n of [
      "myTask",
      "a_b",
      "T_shirt",
      "count_T",
      "fetch_data",
      "GET_T_oken",
    ]) {
      expect(() => validateTaskName(n)).not.toThrow();
    }
  });

  it("rejects dashes, empty, too long, and reserved token", () => {
    for (const n of ["fetch-data", "rule-a", "step-1", "T-1", ""]) {
      expect(() => validateTaskName(n)).toThrow(DagInvalidTaskNameError);
    }
    expect(() => validateTaskName("a".repeat(101))).toThrow(
      DagInvalidTaskNameError,
    );
    expect(() => validateTaskName("DAG_NODE_T_root")).toThrow(
      DagInvalidTaskNameError,
    );
    expect(() => validateTaskName("myDAG_NODE_T_x")).toThrow(
      DagInvalidTaskNameError,
    );
  });
});

describe("detectCycle", () => {
  it("returns null for a diamond (acyclic)", () => {
    const a = makeTask("a");
    const b = makeTask("b", [a]);
    const c = makeTask("c", [a]);
    const d = makeTask("d", [b, c]);
    expect(detectCycle([a, b, c, d])).toBeNull();
  });

  it("detects a self-loop", () => {
    const a = makeTask("a");
    a.allDeps = [handleOf(a)];
    expect(detectCycle([a])).toEqual(["a"]);
  });

  it("detects a 2-cycle", () => {
    const a = makeTask("a");
    const b = makeTask("b");
    a.allDeps = [handleOf(b)];
    b.allDeps = [handleOf(a)];
    const cyc = detectCycle([a, b]);
    expect(cyc?.sort()).toEqual(["a", "b"]);
  });
});

describe("validateDag", () => {
  it("passes for a valid graph", () => {
    const a = makeTask("a");
    const b = makeTask("b", [a]);
    expect(() => validateDag([a, b])).not.toThrow();
  });

  it("throws on duplicate names", () => {
    const a = makeTask("dup");
    const b = makeTask("dup");
    expect(() => validateDag([a, b])).toThrow(DagDuplicateTaskError);
  });

  it("throws on foreign/missing dependency", () => {
    const foreign = makeTask("foreign");
    const a = makeTask("a");
    a.allDeps = [handleOf(foreign)];
    expect(() => validateDag([a])).toThrow(DagInvalidDependencyError);
  });

  it("throws on cycle", () => {
    const a = makeTask("a");
    const b = makeTask("b");
    a.allDeps = [handleOf(b)];
    b.allDeps = [handleOf(a)];
    expect(() => validateDag([a, b])).toThrow(DagCyclicDependencyError);
  });
});
