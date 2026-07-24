import { TaskDef, TaskHandleImpl } from "./task-handle";
import { AnyTaskHandle } from "../../types/dag";
import { createTestDurableContext } from "../../testing/create-test-durable-context";

const makeDef = (name: string): TaskDef => ({
  name,
  id: Symbol(name),
  kind: "step",
  inlineDeps: [],
  allDeps: [],
  executor: async () => undefined,
});

describe("TaskHandleImpl builder", () => {
  it("exposes name and symbol id", () => {
    const def = makeDef("a");
    const handle = new TaskHandleImpl("a", def.id, def);
    expect(handle._name).toBe("a");
    expect(typeof handle._id).toBe("symbol");
  });

  it(".deps() appends to allDeps only, de-duplicated, and chains", () => {
    const def = makeDef("target");
    const handle = new TaskHandleImpl("target", def.id, def);
    const depDef = makeDef("dep");
    const depHandle = new TaskHandleImpl("dep", depDef.id, depDef);
    const returned = handle.deps(depHandle).deps(depHandle);
    expect(returned).toBe(handle);
    expect(def.allDeps).toHaveLength(1);
    expect((def.allDeps[0] as AnyTaskHandle)._name).toBe("dep");
    expect(def.inlineDeps).toHaveLength(0);
  });

  it(".triggerRule() mutates the backing def and chains", () => {
    const def = makeDef("a");
    const handle = new TaskHandleImpl("a", def.id, def);
    expect(handle.triggerRule("ALL_DONE")).toBe(handle);
    expect(def.triggerRule).toBe("ALL_DONE");
  });
});

describe("createTaskId (entity IDs)", () => {
  it("uses DAG_NODE_T_ prefixing (unprefixed context)", () => {
    const { context } = createTestDurableContext();
    expect(context.createTaskId("fetch")).toBe("DAG_NODE_T_fetch");
  });

  it("prefixes with the context step prefix", () => {
    const { context } = createTestDurableContext({ stepPrefix: "1-2" });
    expect(context.createTaskId("fetch")).toBe("1-2-DAG_NODE_T_fetch");
  });

  it("is disjoint from counter IDs and supports nested recursion", () => {
    const { context } = createTestDurableContext({ stepPrefix: "1-2" });
    const id = context.createTaskId("validation");
    expect(id).toContain("DAG_NODE_T_");
    // A nested task under the container would extend the same delimiter.
    const nested = `${id}-DAG_NODE_T_rule_a`;
    expect(nested).toBe("1-2-DAG_NODE_T_validation-DAG_NODE_T_rule_a");
    // Counter IDs never contain the token.
    expect("1-2-1").not.toContain("DAG_NODE_T_");
  });
});
