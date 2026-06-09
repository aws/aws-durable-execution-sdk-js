import { createRunInChildContextHandler } from "./run-in-child-context-handler";
import { ExecutionContext, OperationSubType } from "../../types";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import {
  createMockCheckpoint,
  CheckpointFunction,
} from "../../testing/mock-checkpoint";
import { OperationType, OperationStatus } from "@aws-sdk/client-lambda";
import { hashId, getStepData } from "../../utils/step-id-utils/step-id-utils";
import { DurableExecutionMode } from "../../types/core";
import {
  DurableInstrumentationPlugin,
  OperationInfo,
} from "../../types/plugin";

jest.mock("../../utils/context-tracker/context-tracker", () => ({
  ...jest.requireActual("../../utils/context-tracker/context-tracker"),
}));

describe("run-in-child-context-handler plugin: wrapChildContextFn", () => {
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockCheckpoint: jest.MockedFunction<CheckpointFunction>;
  let mockParentContext: any;
  let createStepId: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();

    mockExecutionContext = {
      state: {
        getStepData: jest.fn(),
        checkpoint: jest.fn(),
      },
      _stepData: {},
      terminationManager: {
        terminate: jest.fn(),
        getTerminationPromise: jest.fn(),
      },
      mutex: {
        lock: jest.fn((fn) => fn()),
      },
      getStepData: jest.fn((stepId: string) => {
        return getStepData(mockExecutionContext._stepData, stepId);
      }),
    } as unknown as jest.Mocked<ExecutionContext>;

    mockCheckpoint = createMockCheckpoint();
    mockParentContext = { awsRequestId: "mock-request-id" };
    createStepId = jest.fn().mockReturnValue(TEST_CONSTANTS.CHILD_CONTEXT_ID);
  });

  function createHandler(plugin?: DurableInstrumentationPlugin) {
    const mockGetLogger = jest.fn().mockReturnValue({
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    });
    const mockCreateChildContext = jest.fn().mockReturnValue({
      _stepPrefix: TEST_CONSTANTS.CHILD_CONTEXT_ID,
    });
    const mockParentDurableContext = "parent-step-123";

    return createRunInChildContextHandler(
      mockExecutionContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      mockGetLogger,
      mockCreateChildContext,
      mockParentDurableContext,
      undefined, // getDefaultSerdes
      plugin,
    );
  }

  describe("wrapChildContextFn wraps child function execution", () => {
    it("calls wrapChildContextFn and uses its return value as the result", async () => {
      const wrappedResult = "wrapped-result";
      const plugin: DurableInstrumentationPlugin = {
        wrapChildContextFn: jest.fn((_info, fn) => {
          // Call the original function but return a different value
          fn();
          return wrappedResult;
        }),
      };

      const childFn = jest.fn().mockResolvedValue("original-result");
      const handler = createHandler(plugin);

      const result = await handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn);

      expect(plugin.wrapChildContextFn).toHaveBeenCalledTimes(1);
      // The wrapped result is used (after serialization/deserialization through the handler)
      expect(result).toBe(wrappedResult);
    });

    it("passes the child function as the fn argument to wrapChildContextFn", async () => {
      let capturedFn: (() => unknown) | undefined;
      const plugin: DurableInstrumentationPlugin = {
        wrapChildContextFn: jest.fn((info, fn) => {
          capturedFn = fn;
          return fn();
        }),
      };

      const childFn = jest.fn().mockResolvedValue("child-result");
      const handler = createHandler(plugin);

      await handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn);

      expect(capturedFn).toBeDefined();
      expect(childFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("OperationInfo contains correct fields", () => {
    it("passes OperationInfo with hashed Id, Name, Type=CONTEXT, SubType=RUN_IN_CHILD_CONTEXT, and hashed ParentId", async () => {
      const plugin: DurableInstrumentationPlugin = {
        wrapChildContextFn: jest.fn((_info, fn) => fn()),
      };

      const childFn = jest.fn().mockResolvedValue("result");
      const handler = createHandler(plugin);

      await handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn);

      expect(plugin.wrapChildContextFn).toHaveBeenCalledTimes(1);
      const operationInfo: OperationInfo = (
        plugin.wrapChildContextFn as jest.Mock
      ).mock.calls[0][0];

      expect(operationInfo.Id).toBe(hashId(TEST_CONSTANTS.CHILD_CONTEXT_ID));
      expect(operationInfo.Name).toBe(TEST_CONSTANTS.CHILD_CONTEXT_NAME);
      expect(operationInfo.Type).toBe(OperationType.CONTEXT);
      expect(operationInfo.SubType).toBe(OperationSubType.RUN_IN_CHILD_CONTEXT);
      expect(operationInfo.ParentId).toBe(hashId("parent-step-123"));
    });

    it("sets ParentId to undefined when parentId is not provided", async () => {
      const plugin: DurableInstrumentationPlugin = {
        wrapChildContextFn: jest.fn((_info, fn) => fn()),
      };

      const mockGetLogger = jest.fn().mockReturnValue({
        log: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      });
      const mockCreateChildContext = jest.fn().mockReturnValue({
        _stepPrefix: TEST_CONSTANTS.CHILD_CONTEXT_ID,
      });

      // Create handler without parentId (undefined)
      const handler = createRunInChildContextHandler(
        mockExecutionContext,
        mockCheckpoint,
        mockParentContext,
        createStepId,
        mockGetLogger,
        mockCreateChildContext,
        undefined, // no parentId
        undefined, // getDefaultSerdes
        plugin,
      );

      const childFn = jest.fn().mockResolvedValue("result");
      await handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn);

      const operationInfo: OperationInfo = (
        plugin.wrapChildContextFn as jest.Mock
      ).mock.calls[0][0];

      expect(operationInfo.ParentId).toBeUndefined();
    });
  });

  describe("graceful fallback when wrapChildContextFn is not defined", () => {
    it("executes child function directly when plugin is an empty object", async () => {
      const plugin: DurableInstrumentationPlugin = {};

      const childFn = jest.fn().mockResolvedValue("direct-result");
      const handler = createHandler(plugin);

      const result = await handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn);

      expect(result).toBe("direct-result");
      expect(childFn).toHaveBeenCalledTimes(1);
    });

    it("executes child function directly when plugin is undefined", async () => {
      const handler = createHandler(undefined);

      const childFn = jest.fn().mockResolvedValue("no-plugin-result");

      const result = await handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn);

      expect(result).toBe("no-plugin-result");
      expect(childFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("wrapChildContextFn is NOT called on the replay/completed path", () => {
    it("does not call wrapChildContextFn when child context has SUCCEEDED status", async () => {
      const plugin: DurableInstrumentationPlugin = {
        wrapChildContextFn: jest.fn((_info, fn) => fn()),
      };

      // Set up a completed child context in stepData
      mockExecutionContext._stepData[hashId(TEST_CONSTANTS.CHILD_CONTEXT_ID)] =
        {
          Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          ContextDetails: {
            Result: JSON.stringify("cached-result"),
          },
        } as any;

      const childFn = jest.fn().mockResolvedValue("new-result");
      const handler = createHandler(plugin);

      const result = await handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn);

      expect(result).toBe("cached-result");
      expect(plugin.wrapChildContextFn).not.toHaveBeenCalled();
      expect(childFn).not.toHaveBeenCalled();
    });

    it("does not call wrapChildContextFn when child context has FAILED status", async () => {
      const plugin: DurableInstrumentationPlugin = {
        wrapChildContextFn: jest.fn((_info, fn) => fn()),
      };

      // Set up a failed child context in stepData
      mockExecutionContext._stepData[hashId(TEST_CONSTANTS.CHILD_CONTEXT_ID)] =
        {
          Id: TEST_CONSTANTS.CHILD_CONTEXT_ID,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.FAILED,
          ContextDetails: {
            Error: {
              ErrorMessage: "previous failure",
              ErrorType: "Error",
            },
          },
        } as any;

      const childFn = jest.fn().mockResolvedValue("new-result");
      const handler = createHandler(plugin);

      await expect(
        handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn),
      ).rejects.toThrow("previous failure");

      expect(plugin.wrapChildContextFn).not.toHaveBeenCalled();
      expect(childFn).not.toHaveBeenCalled();
    });
  });
});
