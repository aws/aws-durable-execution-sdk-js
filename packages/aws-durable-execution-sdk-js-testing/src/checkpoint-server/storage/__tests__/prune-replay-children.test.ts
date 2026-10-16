import {
  Operation,
  OperationStatus,
  OperationType,
} from "@aws/durable-execution-sdk-js";
import { pruneReplayChildren } from "../prune-replay-children";

const step = (
  Id: string,
  ParentId: string | undefined,
  Status: OperationStatus = OperationStatus.SUCCEEDED,
): Operation => ({
  Id,
  ParentId,
  Type: OperationType.STEP,
  Status,
  StartTimestamp: undefined,
});

const context = (
  Id: string,
  ParentId: string | undefined,
  Status: OperationStatus,
  ReplayChildren?: boolean,
): Operation => ({
  Id,
  ParentId,
  Type: OperationType.CONTEXT,
  Status,
  StartTimestamp: undefined,
  ContextDetails: { ReplayChildren },
});

const prune = (operations: Operation[]): string[] =>
  pruneReplayChildren(operations, (operation) => operation).map(
    (operation) => operation.Id as string,
  );

describe("pruneReplayChildren", () => {
  // The same tree as the service's own test for this rule. Each comment
  // states the service's expected result.
  const serviceTree: Operation[] = [
    // Step with no parent: kept
    step("1-step", undefined),
    // In-progress context: kept
    context("2-context", undefined, OperationStatus.STARTED),
    // In-progress step in in-progress context: kept
    step("2.1-step", "2-context", OperationStatus.PENDING),
    // Step with a parent that is not in the state: kept
    step("3-step", "does-not-exist"),
    // Failed context without ReplayChildren: kept
    context("4-context", undefined, OperationStatus.FAILED),
    // ReplayChildren=true, but inside a completed context without it: omitted
    context("4.1-context", "4-context", OperationStatus.FAILED, true),
    // Under an ancestor without ReplayChildren: omitted
    step("4.1.1-step", "4.1-context", OperationStatus.FAILED),
    step("4.1.2-step", "4.1-context", OperationStatus.FAILED),
    // Succeeded context with ReplayChildren=true: kept
    context("5-context", undefined, OperationStatus.SUCCEEDED, true),
    // Completed with ReplayChildren=false, inside one with true: kept
    context("5.1-context", "5-context", OperationStatus.SUCCEEDED, false),
    // Inside a completed context with ReplayChildren=false: omitted
    step("5.1.1-step", "5.1-context"),
    // Inside a completed context with ReplayChildren=true: kept
    step("5.1-step", "5-context"),
  ];

  it("omits the same operations as the service", () => {
    expect(prune(serviceTree)).toEqual([
      "1-step",
      "2-context",
      "2.1-step",
      "3-step",
      "4-context",
      "5-context",
      "5.1-context",
      "5.1-step",
    ]);
  });

  it("gives the same result when children come before their parents", () => {
    expect(prune([...serviceTree].reverse())).toEqual(
      [
        "1-step",
        "2-context",
        "2.1-step",
        "3-step",
        "4-context",
        "5-context",
        "5.1-context",
        "5.1-step",
      ].reverse(),
    );
  });

  // A map or parallel can complete early while a branch is still running.
  // The branch context stays STARTED. The service walks past it to the
  // completed ancestor, so it omits the branch and its children.
  it("omits a STARTED context and its children under a completed context", () => {
    expect(
      prune([
        context("map", undefined, OperationStatus.SUCCEEDED),
        context("branch", "map", OperationStatus.STARTED),
        step("branch-step", "branch", OperationStatus.PENDING),
        context("inner", "branch", OperationStatus.SUCCEEDED, true),
        step("inner-step", "inner"),
      ]),
    ).toEqual(["map"]);
  });

  it("keeps the children of a context while it runs", () => {
    expect(
      prune([
        context("outer", undefined, OperationStatus.STARTED),
        step("outer-step", "outer"),
        context("inner", "outer", OperationStatus.STARTED),
        step("inner-step", "inner", OperationStatus.STARTED),
      ]),
    ).toEqual(["outer", "outer-step", "inner", "inner-step"]);
  });

  it("treats an absent ReplayChildren as false", () => {
    expect(
      prune([
        context("ctx", undefined, OperationStatus.SUCCEEDED),
        step("child", "ctx"),
      ]),
    ).toEqual(["ctx"]);
  });

  // The checkpoint validator prevents a cycle. The walk still terminates if
  // one appears, and keeps the operations on it.
  it.each([
    ["an operation that is its own parent", [step("a", "a")]],
    [
      "two operations that are each other's parent",
      [step("a", "b"), step("b", "a")],
    ],
  ])("terminates for %s", (_label, operations) => {
    expect(prune(operations)).toEqual(operations.map((op) => op.Id));
  });
});
