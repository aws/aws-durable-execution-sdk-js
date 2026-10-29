/**
 * The execution viewer's state machine: which messages it sends, which replies
 * it keeps, and when it polls. Runs with the fake React and host bridge that
 * test.mjs swaps in for `*.hook.test.ts` files.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { sent } from "./testing/fakeHostBridge";
import { intervals, mount, tick } from "./testing/fakeReact";
import { useExecutionViewer } from "./useExecutionViewer";

const A =
  "arn:aws:lambda:us-east-1:123456789012:function:orders:3/durable-execution/run-1/abc";
const B =
  "arn:aws:lambda:eu-west-1:123456789012:function:billing:$LATEST/durable-execution/run-9/xyz";
const detail = (arn: string, status: string) => ({
  arn,
  status,
  functionArn: arn.split("/durable-execution/")[0],
  history: [],
  operations: [],
  invocations: [],
});

type Viewer = ReturnType<typeof useExecutionViewer>;
type Reply = Parameters<Viewer["apply"]>[0];
const types = () => sent.map((m) => m.type);

describe("useExecutionViewer", () => {
  let h: { get: () => Viewer };
  const apply = (msg: unknown) => h.get().apply(msg as Reply);
  beforeEach(() => {
    sent.length = 0;
    h = mount(() => useExecutionViewer(true));
  });

  it("loads the function list once, when first shown", () => {
    assert.deepEqual(types(), ["listFunctions"]);
  });

  it("drops a reply for a function the user has left", () => {
    h.get().openFunction("orders");
    h.get().openFunction("billing");
    apply({
      type: "executionsList",
      functionName: "orders",
      append: false,
      executions: [{ arn: A, name: "run-1", status: "RUNNING" }],
    });
    assert.equal(h.get().executions.length, 0);
    assert.equal(h.get().fnName, "billing");
  });

  it("drops a detail reply for an execution the user has left", () => {
    h.get().openExecution(A);
    h.get().openExecution(B);
    apply({ type: "executionDetail", arn: A, detail: detail(A, "RUNNING") });
    assert.equal(h.get().detail, null);
  });

  it("polls a running execution, skips a tick while a request is out, and stops when it ends", () => {
    h.get().openExecution(A);
    apply({ type: "executionDetail", arn: A, detail: detail(A, "RUNNING") });
    assert.equal(intervals.size, 1);
    sent.length = 0;
    tick();
    tick(); // the first poll has not been answered: no second request
    assert.deepEqual(types(), ["getExecution"]);
    apply({ type: "executionDetail", arn: A, detail: detail(A, "SUCCEEDED") });
    assert.equal(intervals.size, 0);
  });

  it("does not poll an execution with no status", () => {
    h.get().openExecution(A);
    apply({ type: "executionDetail", arn: A, detail: detail(A, "") });
    assert.equal(intervals.size, 0);
  });

  it("asks for a function in the region of the execution it was reached from", () => {
    h.get().openExecution(B);
    sent.length = 0;
    h.get().goTo("function");
    const info = sent.find((m) => m.type === "getFunctionInfo");
    const list = sent.find((m) => m.type === "listExecutions");
    assert.equal(info?.region, "eu-west-1");
    assert.equal(list?.region, "eu-west-1");
    assert.equal(info?.functionName, "billing");
  });

  it("loads the breadcrumb function page even when another list was loading", () => {
    h.get().openFunction("orders");
    h.get().openExecution(B);
    apply({
      type: "executionsList",
      functionName: "orders",
      append: false,
      executions: [],
    });
    sent.length = 0;
    h.get().goTo("function");
    assert.deepEqual(types(), ["getFunctionInfo", "listExecutions"]);
  });
});
