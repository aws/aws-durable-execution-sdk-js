import { createRunInChildContextHandler } from "./run-in-child-context-handler";
import { ExecutionContext } from "../../types";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { hashId, getStepData } from "../../utils/step-id-utils/step-id-utils";
import {
  createMockCheckpoint,
  CheckpointFunction,
} from "../../testing/mock-checkpoint";
import { createErrorObjectFromError } from "../../utils/error-object/error-object";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import { DurableInstrumentationPlugin } from "../../types/plugin";

jest.mock("../../utils/logger/logger");

describe("RunInChildContext Handler - plugin hooks", () => {
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockCheckpoint: jest.MockedFunction<CheckpointFunction>;
  let mockParentContext: any;
  let createStepId: jest.Mock;
  let mockPlugin: jest.Mocked<DurableInstrumentationPlugin>;
  let mockGetLogger: jest.Mock;
  let mockCreateChildContext: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    mockExecutionContext = {
      _stepData: {},
      terminationManager: { terminate: jest.fn() },
      getStepData: jest.fn((stepId: string) => {
        return getStepData(mockExecutionContext._stepData, stepId);
      }),
    } as unknown as jest.Mocked<ExecutionContext>;
    mockCheckpoint = createMockCheckpoint();
    mockParentContext = { awsRequestId: "mock-request-id" };
    createStepId = jest.fn().mockReturnValue(TEST_CONSTANTS.CHILD_CONTEXT_ID);
    mockPlugin = {
      onOperationStart: jest.fn(),
      onOperationEnd: jest.fn(),
    };
    mockGetLogger = jest.fn().mockReturnValue({
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    });
    mockCreateChildContext = jest.fn().mockReturnValue({
      _stepPrefix: TEST_CONSTANTS.CHILD_CONTEXT_ID,
    });
  });

  it("should call onOperationStart and onOperationEnd on successful execution", async () => {
    const handler = createRunInChildContextHandler(
      mockExecutionContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      mockGetLogger,
      mockCreateChildContext,
      "parent-123",
      mockPlugin,
    );

    const childFn = jest.fn().mockResolvedValue("result");
    await handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn);

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.not.objectContaining({ error: expect.anything() }),
    );
  });

  it("should call onOperationEnd with error on failed execution", async () => {
    const handler = createRunInChildContextHandler(
      mockExecutionContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      mockGetLogger,
      mockCreateChildContext,
      "parent-123",
      mockPlugin,
    );

    const childFn = jest.fn().mockRejectedValue(new Error("child failed"));

    await expect(
      handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn),
    ).rejects.toThrow("child failed");

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it("should call onOperationEnd on replay completed", async () => {
    mockExecutionContext._stepData[hashId(TEST_CONSTANTS.CHILD_CONTEXT_ID)] = {
      Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
      Type: OperationType.CONTEXT,
      StartTimestamp: new Date(),
      Status: OperationStatus.SUCCEEDED,
      ContextDetails: { Result: JSON.stringify("cached-result") },
    } as any;

    const handler = createRunInChildContextHandler(
      mockExecutionContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      mockGetLogger,
      mockCreateChildContext,
      "parent-123",
      mockPlugin,
    );

    const childFn = jest.fn();
    const result = await handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn);

    expect(result).toBe("cached-result");
    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
  });

  it("should not throw when plugin hooks are undefined", async () => {
    const handler = createRunInChildContextHandler(
      mockExecutionContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      mockGetLogger,
      mockCreateChildContext,
      "parent-123",
      {},
    );

    const childFn = jest.fn().mockResolvedValue("result");
    const result = await handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn);
    expect(result).toBe("result");
  });
});
