import { normalizeOperation, normalizeOperations } from "./normalize-operation";
import {
  OperationStatus,
  OperationType,
  WireOperation,
} from "../../types/wire";

const wireOperation = (
  overrides: Partial<WireOperation> = {},
): WireOperation => ({
  Id: "op-1",
  Type: OperationType.STEP,
  Status: OperationStatus.SUCCEEDED,
  StartTimestamp: "2026-07-13T22:11:27.127Z",
  ...overrides,
});

describe("normalizeOperation", () => {
  it("converts ISO-8601 string timestamps from the invocation event into Dates", () => {
    const result = normalizeOperation(
      wireOperation({
        StartTimestamp: "2026-07-13T22:11:27.127Z",
        EndTimestamp: "2026-07-13T22:11:29.500Z",
      }),
    );

    expect(result.StartTimestamp).toEqual(new Date("2026-07-13T22:11:27.127Z"));
    expect(result.EndTimestamp).toEqual(new Date("2026-07-13T22:11:29.500Z"));
  });

  it("passes Date timestamps from AWS SDK responses through unchanged", () => {
    const start = new Date("2026-07-13T22:11:27.127Z");
    const result = normalizeOperation(wireOperation({ StartTimestamp: start }));

    expect(result.StartTimestamp).toBe(start);
  });

  it("normalizes the step retry timestamp", () => {
    const result = normalizeOperation(
      wireOperation({
        StepDetails: {
          Attempt: 2,
          NextAttemptTimestamp: "2026-07-13T22:12:00.000Z",
          Result: '"ok"',
        },
      }),
    );

    expect(result.StepDetails?.NextAttemptTimestamp).toEqual(
      new Date("2026-07-13T22:12:00.000Z"),
    );
    // Non-timestamp members are carried across untouched.
    expect(result.StepDetails?.Attempt).toBe(2);
    expect(result.StepDetails?.Result).toBe('"ok"');
  });

  it("normalizes the wait end timestamp", () => {
    const result = normalizeOperation(
      wireOperation({
        Type: OperationType.WAIT,
        WaitDetails: { ScheduledEndTimestamp: "2026-07-13T23:00:00.000Z" },
      }),
    );

    expect(result.WaitDetails?.ScheduledEndTimestamp).toEqual(
      new Date("2026-07-13T23:00:00.000Z"),
    );
  });

  it("carries every other member across unchanged", () => {
    const operation = wireOperation({
      ParentId: "parent-1",
      Name: "my-step",
      SubType: "STEP",
      ContextDetails: { ReplayChildren: true, Result: '"ctx"' },
      CallbackDetails: { CallbackId: "cb-1" },
      ChainedInvokeDetails: { Result: '"chained"' },
      ExecutionDetails: { InputPayload: '"input"' },
    });

    const result = normalizeOperation(operation);

    expect(result.Id).toBe("op-1");
    expect(result.ParentId).toBe("parent-1");
    expect(result.Name).toBe("my-step");
    expect(result.Type).toBe(OperationType.STEP);
    expect(result.SubType).toBe("STEP");
    expect(result.Status).toBe(OperationStatus.SUCCEEDED);
    expect(result.ContextDetails).toEqual(operation.ContextDetails);
    expect(result.CallbackDetails).toEqual(operation.CallbackDetails);
    expect(result.ChainedInvokeDetails).toEqual(operation.ChainedInvokeDetails);
    expect(result.ExecutionDetails).toEqual(operation.ExecutionDetails);
  });

  it("preserves the key set of the wire operation", () => {
    const operation = wireOperation({
      EndTimestamp: undefined,
      StepDetails: undefined,
    });

    expect(Object.keys(normalizeOperation(operation)).sort()).toEqual(
      Object.keys(operation).sort(),
    );
  });

  it("preserves an explicitly undefined WaitDetails key", () => {
    // The WAIT twin of the case above: a present-but-undefined member must survive
    // normalization as a present-but-undefined member, not be dropped.
    const operation = wireOperation({
      Type: OperationType.WAIT,
      WaitDetails: undefined,
    });

    const result = normalizeOperation(operation);

    expect("WaitDetails" in result).toBe(true);
    expect(result.WaitDetails).toBeUndefined();
    expect(Object.keys(result).sort()).toEqual(Object.keys(operation).sort());
  });

  it("does not invent optional members that were absent", () => {
    const result = normalizeOperation(wireOperation());

    expect("EndTimestamp" in result).toBe(false);
    expect("StepDetails" in result).toBe(false);
    expect("WaitDetails" in result).toBe(false);
  });

  it("leaves an absent start timestamp undefined", () => {
    const result = normalizeOperation(
      wireOperation({ StartTimestamp: undefined }),
    );

    expect(result.StartTimestamp).toBeUndefined();
  });

  it("does not mutate the input operation", () => {
    const operation = wireOperation({
      StepDetails: { NextAttemptTimestamp: "2026-07-13T22:12:00.000Z" },
    });

    normalizeOperation(operation);

    expect(operation.StartTimestamp).toBe("2026-07-13T22:11:27.127Z");
    expect(operation.StepDetails?.NextAttemptTimestamp).toBe(
      "2026-07-13T22:12:00.000Z",
    );
  });
});

describe("normalizeOperations", () => {
  it("normalizes every operation in the list", () => {
    const result = normalizeOperations([
      wireOperation({ Id: "op-1", StartTimestamp: "2026-07-13T22:11:27.127Z" }),
      wireOperation({ Id: "op-2", StartTimestamp: "2026-07-13T22:11:28.000Z" }),
    ]);

    expect(result.map((op) => op.Id)).toEqual(["op-1", "op-2"]);
    expect(result.every((op) => op.StartTimestamp instanceof Date)).toBe(true);
  });

  it("returns an empty list unchanged", () => {
    expect(normalizeOperations([])).toEqual([]);
  });
});
