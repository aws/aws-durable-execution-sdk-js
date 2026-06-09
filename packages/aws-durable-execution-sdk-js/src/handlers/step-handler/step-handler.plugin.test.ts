import { createStepHandler } from "./step-handler";
import {
  ExecutionContext,
  OperationSubType,
  DurableExecutionMode,
} from "../../types";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { Context } from "aws-lambda";
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

describe("Step Handler - wrapOperationAttemptFn plugin hook", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let mockParentContext: Context;
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

    mockParentContext = {
      getRemainingTimeInMillis: jest.fn().mockReturnValue(30000),
    } as any;

    createStepId = (): string => `step-${++stepIdCounter}`;

    mockSafeSerialize.mockImplementation(async (_serdes, value) =>
      JSON.stringify(value),
    );
    mockSafeDeserialize.mockImplementation(async (_serdes, value) =>
      value ? JSON.parse(value) : undefined,
    );
  });

  it("wraps user code with wrapOperationAttemptFn and uses hook return value as step result", async () => {
    const plugin: DurableInstrumentationPlugin = {
      wrapOperationAttemptFn: jest.fn((_info: AttemptInfo, fn) => {
        // Call the user function and return a modified result
        return fn();
      }),
    };

    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
      undefined, // parentId
      undefined, // getDefaultSerdes
      plugin,
    );

    const stepFn = jest.fn().mockResolvedValue("step-result");

    const result = await stepHandler("test-step", stepFn);

    expect(result).toBe("step-result");
    expect(plugin.wrapOperationAttemptFn).toHaveBeenCalledTimes(1);
    expect(stepFn).toHaveBeenCalledTimes(1);
  });

  it("uses the hook return value as the step execution result (hook can transform)", async () => {
    const plugin: DurableInstrumentationPlugin = {
      wrapOperationAttemptFn: jest.fn(async (_info: AttemptInfo, fn) => {
        const original = await (fn() as Promise<string>);
        return `wrapped-${original}`;
      }),
    };

    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      plugin,
    );

    const stepFn = jest.fn().mockResolvedValue("original");

    const result = await stepHandler("test-step", stepFn);

    expect(result).toBe("wrapped-original");
    expect(plugin.wrapOperationAttemptFn).toHaveBeenCalledTimes(1);
  });

  it("passes correct AttemptInfo with Id, Name, Type, SubType, ParentId, Attempt", async () => {
    const parentId = "parent-ctx-1";
    let capturedInfo: AttemptInfo | undefined;

    const plugin: DurableInstrumentationPlugin = {
      wrapOperationAttemptFn: jest.fn((info: AttemptInfo, fn) => {
        capturedInfo = info;
        return fn();
      }),
    };

    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
      parentId,
      undefined,
      plugin,
    );

    const stepFn = jest.fn().mockResolvedValue("result");

    await stepHandler("my-step", stepFn);

    expect(capturedInfo).toBeDefined();
    expect(capturedInfo!.Id).toBe(hashId("step-1"));
    expect(capturedInfo!.Name).toBe("my-step");
    expect(capturedInfo!.Type).toBe(OperationType.STEP);
    expect(capturedInfo!.SubType).toBe(OperationSubType.STEP);
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

    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
      undefined, // no parentId
      undefined,
      plugin,
    );

    const stepFn = jest.fn().mockResolvedValue("result");

    await stepHandler("my-step", stepFn);

    expect(capturedInfo).toBeDefined();
    expect(capturedInfo!.ParentId).toBeUndefined();
  });

  it("increments Attempt number on retry", async () => {
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
      // First call: return null (no stepData yet)
      if (callCount <= 1) return null;
      // After START checkpoint: return STARTED with Attempt 0
      if (callCount <= 3) {
        return {
          Id: hashId("step-1"),
          Status: OperationStatus.STARTED,
          StepDetails: { Attempt: 0 },
        };
      }
      // After retry checkpoint + waitForRetryTimer: return with Attempt 1
      return {
        Id: hashId("step-1"),
        Status: OperationStatus.STARTED,
        StepDetails: { Attempt: 1 },
      };
    });

    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      plugin,
    );

    let attemptCount = 0;
    const stepFn = jest.fn().mockImplementation(async () => {
      attemptCount++;
      if (attemptCount === 1) {
        throw new Error("transient failure");
      }
      return "success-on-retry";
    });

    const result = await stepHandler("retry-step", stepFn, {
      retryStrategy: (_error, attempt) => ({
        shouldRetry: attempt < 3,
        delay: { seconds: 1 },
      }),
    });

    expect(result).toBe("success-on-retry");
    expect(capturedAttempts.length).toBe(2);
    expect(capturedAttempts[0]).toBe(1);
    expect(capturedAttempts[1]).toBe(2);
  });

  it("executes user step function directly when wrapOperationAttemptFn is not defined", async () => {
    const plugin: DurableInstrumentationPlugin = {};

    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      plugin,
    );

    const stepFn = jest.fn().mockResolvedValue("direct-result");

    const result = await stepHandler("test-step", stepFn);

    expect(result).toBe("direct-result");
    expect(stepFn).toHaveBeenCalledTimes(1);
  });

  it("executes user step function directly when plugin is undefined", async () => {
    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
      undefined,
      undefined,
      undefined, // no plugin
    );

    const stepFn = jest.fn().mockResolvedValue("no-plugin-result");

    const result = await stepHandler("test-step", stepFn);

    expect(result).toBe("no-plugin-result");
    expect(stepFn).toHaveBeenCalledTimes(1);
  });
});
