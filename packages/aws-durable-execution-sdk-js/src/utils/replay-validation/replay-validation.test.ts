import { validateReplayConsistency } from "./replay-validation";
import { Operation, OperationType } from "../../types/wire";
import { OperationSubType, ExecutionContext } from "../../types";
import { terminateForUnrecoverableError } from "../termination-helper/termination-helper";

jest.mock("../termination-helper/termination-helper");

describe("validateReplayConsistency", () => {
  const mockContext = {} as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should not validate when checkpoint data is undefined", () => {
    const result = validateReplayConsistency(
      "step1",
      {
        type: OperationType.STEP,
        name: "test",
        subType: OperationSubType.STEP,
      },
      undefined,
      mockContext,
    );

    expect(terminateForUnrecoverableError).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("should pass validation when all fields match", () => {
    const checkpointData: Operation = {
      Id: "step1",
      Type: OperationType.STEP,
      Name: "test",
      SubType: OperationSubType.STEP,
      StartTimestamp: new Date(),
      Status: "SUCCEEDED",
    };

    const result = validateReplayConsistency(
      "step1",
      {
        type: OperationType.STEP,
        name: "test",
        subType: OperationSubType.STEP,
      },
      checkpointData,
      mockContext,
    );

    expect(terminateForUnrecoverableError).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("should pass validation when name is undefined in both", () => {
    const checkpointData: Operation = {
      Id: "step1",
      Type: OperationType.STEP,
      Name: undefined,
      SubType: OperationSubType.STEP,
      StartTimestamp: new Date(),
      Status: "SUCCEEDED",
    };

    validateReplayConsistency(
      "step1",
      {
        type: OperationType.STEP,
        name: undefined,
        subType: OperationSubType.STEP,
      },
      checkpointData,
      mockContext,
    );

    expect(terminateForUnrecoverableError).not.toHaveBeenCalled();
  });

  it("should terminate when operation type mismatches", () => {
    const checkpointData: Operation = {
      Id: "step1",
      Type: OperationType.STEP,
      Name: "test",
      SubType: OperationSubType.STEP,
      StartTimestamp: new Date(),
      Status: "SUCCEEDED",
    };

    validateReplayConsistency(
      "step1",
      {
        type: OperationType.WAIT,
        name: "test",
        subType: OperationSubType.STEP,
      },
      checkpointData,
      mockContext,
    );

    expect(terminateForUnrecoverableError).toHaveBeenCalledWith(
      mockContext,
      expect.objectContaining({
        message: expect.stringContaining("Operation type mismatch"),
      }),
      "step1",
    );
  });

  it("should terminate when operation name mismatches", () => {
    const checkpointData: Operation = {
      Id: "step1",
      Type: OperationType.STEP,
      Name: "test1",
      SubType: OperationSubType.STEP,
      StartTimestamp: new Date(),
      Status: "SUCCEEDED",
    };

    validateReplayConsistency(
      "step1",
      {
        type: OperationType.STEP,
        name: "test2",
        subType: OperationSubType.STEP,
      },
      checkpointData,
      mockContext,
    );

    expect(terminateForUnrecoverableError).toHaveBeenCalledWith(
      mockContext,
      expect.objectContaining({
        message: expect.stringContaining("Operation name mismatch"),
      }),
      "step1",
    );
  });

  it("should terminate when name changes from defined to undefined", () => {
    const checkpointData: Operation = {
      Id: "step1",
      Type: OperationType.STEP,
      Name: "test",
      SubType: OperationSubType.STEP,
      StartTimestamp: new Date(),
      Status: "SUCCEEDED",
    };

    validateReplayConsistency(
      "step1",
      {
        type: OperationType.STEP,
        name: undefined,
        subType: OperationSubType.STEP,
      },
      checkpointData,
      mockContext,
    );

    expect(terminateForUnrecoverableError).toHaveBeenCalledWith(
      mockContext,
      expect.objectContaining({
        message: expect.stringContaining("Operation name mismatch"),
      }),
      "step1",
    );
  });

  it("should terminate when operation subtype mismatches", () => {
    const checkpointData: Operation = {
      Id: "step1",
      Type: OperationType.STEP,
      Name: "test",
      SubType: OperationSubType.STEP,
      StartTimestamp: new Date(),
      Status: "SUCCEEDED",
    };

    validateReplayConsistency(
      "step1",
      {
        type: OperationType.STEP,
        name: "test",
        subType: OperationSubType.WAIT,
      },
      checkpointData,
      mockContext,
    );

    expect(terminateForUnrecoverableError).toHaveBeenCalledWith(
      mockContext,
      expect.objectContaining({
        message: expect.stringContaining("Operation subtype mismatch"),
      }),
      "step1",
    );
  });

  it("should hand back the halt promise so the caller stops on a mismatch", async () => {
    // The caller must be able to stop. Reporting the mismatch is not enough on its
    // own: termination resolves asynchronously, and until it does, a caller that
    // carried on would act on checkpoint data belonging to a different operation --
    // deserializing another step's result, or re-running a step body for its side
    // effects.
    const haltPromise = new Promise<never>(() => {});
    (terminateForUnrecoverableError as jest.Mock).mockReturnValue(haltPromise);

    const checkpointData: Operation = {
      Id: "step1",
      Type: OperationType.STEP,
      Name: "step-a",
      SubType: OperationSubType.STEP,
      StartTimestamp: new Date(),
      Status: "SUCCEEDED",
    };

    const result = validateReplayConsistency(
      "step1",
      {
        type: OperationType.STEP,
        name: "step-b",
        subType: OperationSubType.STEP,
      },
      checkpointData,
      mockContext,
    );

    expect(result).toBe(haltPromise);
    await expect(
      Promise.race([result, Promise.resolve("still-pending")]),
    ).resolves.toBe("still-pending");
  });

  it("should report only the first mismatch it finds", () => {
    // Type is checked first; the name and subtype comparisons that follow describe the
    // same divergence, so reporting them as well would add nothing.
    const checkpointData: Operation = {
      Id: "step1",
      Type: OperationType.STEP,
      Name: "step-a",
      SubType: OperationSubType.STEP,
      StartTimestamp: new Date(),
      Status: "SUCCEEDED",
    };

    validateReplayConsistency(
      "step1",
      {
        type: OperationType.WAIT,
        name: "step-b",
        subType: OperationSubType.WAIT,
      },
      checkpointData,
      mockContext,
    );

    expect(terminateForUnrecoverableError).toHaveBeenCalledTimes(1);
    expect(terminateForUnrecoverableError).toHaveBeenCalledWith(
      mockContext,
      expect.objectContaining({
        message: expect.stringContaining("Operation type mismatch"),
      }),
      "step1",
    );
  });
});
