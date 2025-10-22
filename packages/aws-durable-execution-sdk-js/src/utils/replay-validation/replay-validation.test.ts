import { validateReplayConsistency } from "./replay-validation";
import { Operation, OperationType } from "@aws-sdk/client-lambda";
import { OperationSubType, ExecutionContext } from "../../types";
import { terminateForUnrecoverableError } from "../termination-helper/termination-helper";

jest.mock("../termination-helper/termination-helper");

describe("validateReplayConsistency", () => {
  const mockContext = {} as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should not validate when checkpoint data is undefined", () => {
    validateReplayConsistency(
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

    validateReplayConsistency(
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
});
