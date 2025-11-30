import { createWaitForConditionHandler } from "./wait-for-condition-handler";
import {
  DurableLogger,
  ExecutionContext,
  WaitForConditionCheckFunc,
} from "../../types";
import { DurablePromise } from "../../types/durable-promise";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";

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

describe("WaitForCondition Handler Two-Phase Execution", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let createStepId: () => string;
  let stepIdCounter = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    stepIdCounter = 0;

    mockContext = {
      getStepData: jest.fn().mockReturnValue(null),
      durableExecutionArn: "test-arn",
      terminationManager: {
        terminate: jest.fn(),
      },
    } as any;

    mockCheckpoint = {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      markOperationState: jest.fn(),
      markOperationAwaited: jest.fn(),
    } as any;

    createStepId = (): string => `step-${++stepIdCounter}`;

    mockSafeSerialize.mockImplementation(async (_serdes, value) =>
      JSON.stringify(value),
    );
    mockSafeDeserialize.mockImplementation(async (_serdes, value) =>
      value ? JSON.parse(value) : undefined,
    );
  });

  it("should execute check function in phase 1 immediately", async () => {
    const waitForConditionHandler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined,
    );

    const checkFn: WaitForConditionCheckFunc<number, DurableLogger> = jest
      .fn()
      .mockResolvedValue(10);

    const promise = waitForConditionHandler(checkFn, {
      initialState: 0,
      waitStrategy: (_state) => ({ shouldContinue: false }),
    });

    expect(promise).toBeInstanceOf(DurablePromise);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(checkFn).toHaveBeenCalled();
    expect(mockCheckpoint.checkpoint).toHaveBeenCalled();

    await promise;
  });

  it("should return cached result in phase 2 when awaited", async () => {
    const waitForConditionHandler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined,
    );

    const checkFn: WaitForConditionCheckFunc<string, DurableLogger> = jest
      .fn()
      .mockResolvedValue("completed");

    const promise = waitForConditionHandler(checkFn, {
      initialState: "initial",
      waitStrategy: (_state) => ({ shouldContinue: false }),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(checkFn).toHaveBeenCalledTimes(1);

    const result = await promise;

    expect(result).toBe("completed");
    expect(checkFn).toHaveBeenCalledTimes(1);
  });

  it("should execute check function before await", async () => {
    const waitForConditionHandler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      undefined,
    );

    let executionOrder: string[] = [];
    const checkFn: WaitForConditionCheckFunc<number, DurableLogger> = jest.fn(
      async () => {
        executionOrder.push("check-executed");
        return 42;
      },
    );

    executionOrder.push("promise-created");
    const promise = waitForConditionHandler(checkFn, {
      initialState: 0,
      waitStrategy: (_state) => ({ shouldContinue: false }),
    });
    executionOrder.push("after-handler-call");

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(checkFn).toHaveBeenCalled();

    executionOrder.push("before-await");
    const result = await promise;
    executionOrder.push("after-await");

    expect(executionOrder).toEqual([
      "promise-created",
      "check-executed",
      "after-handler-call",
      "before-await",
      "after-await",
    ]);
    expect(result).toBe(42);
  });
});
