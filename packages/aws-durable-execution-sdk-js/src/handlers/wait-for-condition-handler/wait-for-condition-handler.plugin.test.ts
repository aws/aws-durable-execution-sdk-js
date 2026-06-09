import { createWaitForConditionHandler } from "./wait-for-condition-handler";
import { ExecutionContext, OperationSubType } from "../../types";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { AttemptInfo, DurableInstrumentationPlugin } from "../../types/plugin";

jest.mock("../../utils/logger/logger");
jest.mock("../../errors/serdes-errors/serdes-errors");

import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";

const mockSafeSerialize = safeSerialize as jest.MockedFunction<
  typeof safeSerialize
>;
const mockSafeDeserialize = safeDeserialize as jest.MockedFunction<
  typeof safeDeserialize
>;

describe("WaitForCondition Handler - wrapOperationAttemptFn plugin hook", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let createStepId: () => string;
  let stepIdCounter: number;

  beforeEach(() => {
    jest.clearAllMocks();
    stepIdCounter = 0;

    mockContext = {
      getStepData: jest.fn().mockReturnValue(null),
      _stepData: {},
      durableExecutionArn: "test-arn",
      terminationManager: {
        terminate: jest.fn(),
      },
    } as any;

    mockCheckpoint = {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      markOperationState: jest.fn(),
      markOperationAwaited: jest.fn(),
      waitForRetryTimer: jest.fn().mockResolvedValue(undefined),
    } as any;

    createStepId = (): string => `step-${++stepIdCounter}`;

    mockSafeSerialize.mockImplementation(async (_serdes, value) =>
      JSON.stringify(value),
    );
    mockSafeDeserialize.mockImplementation(async (_serdes, value) =>
      value ? JSON.parse(value) : undefined,
    );
  });

  it("wraps check function with wrapOperationAttemptFn and uses hook return value", async () => {
    const plugin: DurableInstrumentationPlugin = {
      wrapOperationAttemptFn: jest.fn((_info: AttemptInfo, fn) => {
        return fn();
      }),
    };

    const handler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined, // parentId
      undefined, // getDefaultSerdes
      plugin,
    );

    const checkFn = jest.fn().mockResolvedValue({ status: "done" });

    const result = await handler("check-condition", checkFn, {
      initialState: { status: "pending" },
      waitStrategy: () => ({ shouldContinue: false, delay: { seconds: 1 } }),
    });

    expect(result).toEqual({ status: "done" });
    expect(plugin.wrapOperationAttemptFn).toHaveBeenCalledTimes(1);
    expect(checkFn).toHaveBeenCalledTimes(1);
  });

  it("passes correct AttemptInfo with SubType=WaitForCondition", async () => {
    const parentId = "parent-ctx-1";
    let capturedInfo: AttemptInfo | undefined;

    const plugin: DurableInstrumentationPlugin = {
      wrapOperationAttemptFn: jest.fn((info: AttemptInfo, fn) => {
        capturedInfo = info;
        return fn();
      }),
    };

    const handler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      parentId,
      undefined,
      plugin,
    );

    const checkFn = jest.fn().mockResolvedValue("result");

    await handler("my-condition", checkFn, {
      initialState: "initial",
      waitStrategy: () => ({ shouldContinue: false, delay: { seconds: 1 } }),
    });

    expect(capturedInfo).toBeDefined();
    expect(capturedInfo!.Id).toBe(hashId("step-1"));
    expect(capturedInfo!.Name).toBe("my-condition");
    expect(capturedInfo!.Type).toBe(OperationType.STEP);
    expect(capturedInfo!.SubType).toBe(OperationSubType.WAIT_FOR_CONDITION);
    expect(capturedInfo!.ParentId).toBe(hashId(parentId));
    expect(capturedInfo!.Attempt).toBe(1);
  });

  it("passes undefined ParentId when parentId is not set", async () => {
    let capturedInfo: AttemptInfo | undefined;

    const plugin: DurableInstrumentationPlugin = {
      wrapOperationAttemptFn: jest.fn((info: AttemptInfo, fn) => {
        capturedInfo = info;
        return fn();
      }),
    };

    const handler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined, // no parentId
      undefined,
      plugin,
    );

    const checkFn = jest.fn().mockResolvedValue("done");

    await handler("my-condition", checkFn, {
      initialState: "start",
      waitStrategy: () => ({ shouldContinue: false, delay: { seconds: 1 } }),
    });

    expect(capturedInfo).toBeDefined();
    expect(capturedInfo!.ParentId).toBeUndefined();
  });

  it("increments Attempt number on each check iteration", async () => {
    const capturedAttempts: number[] = [];

    const plugin: DurableInstrumentationPlugin = {
      wrapOperationAttemptFn: jest.fn((info: AttemptInfo, fn) => {
        capturedAttempts.push(info.Attempt);
        return fn();
      }),
    };

    let callCount = 0;
    (mockContext.getStepData as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount <= 1) return null;
      if (callCount <= 3) {
        return {
          Id: hashId("step-1"),
          Status: OperationStatus.STARTED,
          StepDetails: { Attempt: 0 },
        };
      }
      return {
        Id: hashId("step-1"),
        Status: OperationStatus.STARTED,
        StepDetails: { Attempt: 1 },
      };
    });

    const handler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      plugin,
    );

    let checkCallCount = 0;
    const checkFn = jest.fn().mockImplementation(async () => {
      checkCallCount++;
      return { count: checkCallCount };
    });

    const result = await handler("polling", checkFn, {
      initialState: { count: 0 },
      waitStrategy: (state: { count: number }, attempt: number) => ({
        shouldContinue: attempt < 2,
        delay: { seconds: 1 },
      }),
    });

    expect(result).toEqual({ count: 2 });
    expect(capturedAttempts.length).toBe(2);
    expect(capturedAttempts[0]).toBe(1);
    expect(capturedAttempts[1]).toBe(2);
  });

  it("executes check function directly when wrapOperationAttemptFn is not defined", async () => {
    const plugin: DurableInstrumentationPlugin = {};

    const handler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      plugin,
    );

    const checkFn = jest.fn().mockResolvedValue("direct-result");

    const result = await handler("condition", checkFn, {
      initialState: "initial",
      waitStrategy: () => ({ shouldContinue: false, delay: { seconds: 1 } }),
    });

    expect(result).toBe("direct-result");
    expect(checkFn).toHaveBeenCalledTimes(1);
  });

  it("executes check function directly when plugin is undefined", async () => {
    const handler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      undefined, // no plugin
    );

    const checkFn = jest.fn().mockResolvedValue("no-plugin-result");

    const result = await handler("condition", checkFn, {
      initialState: "initial",
      waitStrategy: () => ({ shouldContinue: false, delay: { seconds: 1 } }),
    });

    expect(result).toBe("no-plugin-result");
    expect(checkFn).toHaveBeenCalledTimes(1);
  });
});
