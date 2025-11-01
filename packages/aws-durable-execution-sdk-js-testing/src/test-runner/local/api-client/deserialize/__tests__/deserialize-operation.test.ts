import { deserializeOperation } from "../deserialize-operation";
import { SerializedOperation } from "../../../../../checkpoint-server/types/operation-event";

describe("deserializeOperation", () => {
  it("should deserialize basic operation fields and convert StartTimestamp", () => {
    const serializedOperation: SerializedOperation = {
      Id: "op-123",
      Name: "TestOperation",
      Type: "STEP",
      Status: "STARTED",
      StartTimestamp: 1609459200,
    };

    const result = deserializeOperation(serializedOperation);

    expect(result.Id).toBe("op-123");
    expect(result.Name).toBe("TestOperation");
    expect(result.Type).toBe("STEP");
    expect(result.Status).toBe("STARTED");
    expect(result.StartTimestamp).toEqual(new Date(1609459200 * 1000));
  });

  it("should convert both StartTimestamp and EndTimestamp", () => {
    const serializedOperation: SerializedOperation = {
      Id: "op-456",
      Type: "STEP",
      Status: "SUCCEEDED",
      StartTimestamp: 1609459200,
      EndTimestamp: 1609459300,
    };

    const result = deserializeOperation(serializedOperation);

    expect(result.StartTimestamp).toEqual(new Date(1609459200 * 1000));
    expect(result.EndTimestamp).toEqual(new Date(1609459300 * 1000));
  });

  it("should deserialize StepDetails with NextAttemptTimestamp conversion", () => {
    const serializedOperation: SerializedOperation = {
      Id: "op-step",
      Type: "STEP",
      Status: "PENDING",
      StartTimestamp: 1609459200,
      StepDetails: {
        Attempt: 2,
        NextAttemptTimestamp: 1609459500,
        Error: {
          ErrorMessage: "Retry error",
          ErrorType: "RetryableError",
        },
      },
    };

    const result = deserializeOperation(serializedOperation);

    expect(result.StepDetails?.Attempt).toBe(2);
    expect(result.StepDetails?.NextAttemptTimestamp).toEqual(
      new Date(1609459500 * 1000),
    );
    expect(result.StepDetails?.Error?.ErrorType).toBe("RetryableError");
  });

  it("should deserialize WaitDetails with ScheduledEndTimestamp conversion", () => {
    const serializedOperation: SerializedOperation = {
      Id: "op-wait",
      Type: "WAIT",
      Status: "STARTED",
      StartTimestamp: 1609459200,
      WaitDetails: {
        ScheduledEndTimestamp: 1609462800,
      },
    };

    const result = deserializeOperation(serializedOperation);

    expect(result.WaitDetails?.ScheduledEndTimestamp).toEqual(
      new Date(1609462800 * 1000),
    );
  });

  it("should deserialize operation with nested detail objects", () => {
    const serializedOperation: SerializedOperation = {
      Id: "op-full",
      Type: "STEP",
      Status: "SUCCEEDED",
      StartTimestamp: 1609459200,
      EndTimestamp: 1609459300,
      StepDetails: {
        Attempt: 1,
        Result: '{"success": true}',
      },
      CallbackDetails: {
        CallbackId: "callback-123",
      },
    };

    const result = deserializeOperation(serializedOperation);

    expect(result.StartTimestamp).toEqual(new Date(1609459200 * 1000));
    expect(result.EndTimestamp).toEqual(new Date(1609459300 * 1000));
    expect(result.StepDetails?.Attempt).toBe(1);
    expect(result.StepDetails?.Result).toBe('{"success": true}');
    expect(result.CallbackDetails?.CallbackId).toBe("callback-123");
  });

  it("should handle optional fields", () => {
    const serializedOperation: SerializedOperation = {
      Id: "op-minimal",
      Type: "STEP",
      Status: "STARTED",
      StartTimestamp: 1609459200,
    };

    const result = deserializeOperation(serializedOperation);

    expect(result.Id).toBe("op-minimal");
    expect(result.StartTimestamp).toEqual(new Date(1609459200 * 1000));
    expect(result.Name).toBeUndefined();
    expect(result.ParentId).toBeUndefined();
    expect(result.EndTimestamp).toBeUndefined();
  });
});
