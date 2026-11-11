import { vi, describe, it, expect, beforeEach } from "vitest";
import { createStepHandler } from "./step-handler";
import { ExecutionContext } from "../../types";
import { DurablePromise } from "../../types/durable-promise";
import { Context } from "aws-lambda";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";

describe("Step Handler Two-Phase Execution", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let mockParentContext: Context;
  let createStepId: () => string;
  let stepIdCounter = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    stepIdCounter = 0;

    mockContext = {
      getStepData: vi.fn().mockReturnValue(null),
      durableExecutionArn: "test-arn",
      terminationManager: {
        terminate: vi.fn(),
      },
    } as any;

    mockCheckpoint = {
      checkpoint: vi.fn().mockResolvedValue(undefined),
      markOperationState: vi.fn(),
      markOperationAwaited: vi.fn(),
    } as any;

    mockParentContext = {
      getRemainingTimeInMillis: vi.fn().mockReturnValue(30000),
    } as any;

    createStepId = (): string => `step-${++stepIdCounter}`;
  });

  it("should execute step logic in phase 1 immediately", async () => {
    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
    );

    const stepFn = vi.fn().mockResolvedValue("result");

    const stepPromise = stepHandler(stepFn);

    expect(stepPromise).toBeInstanceOf(DurablePromise);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(stepFn).toHaveBeenCalled();
    expect(mockCheckpoint.checkpoint).toHaveBeenCalled();

    await stepPromise;
  });

  it("should return cached result in phase 2 when awaited", async () => {
    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
    );

    const stepFn = vi.fn().mockResolvedValue("test-result");

    const stepPromise = stepHandler(stepFn);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const phase1Calls = stepFn.mock.calls.length;
    expect(phase1Calls).toBeGreaterThan(0);

    const result = await stepPromise;

    expect(result).toBe("test-result");
    expect(stepFn.mock.calls.length).toBe(phase1Calls);
    expect((stepPromise as DurablePromise<string>).isExecuted).toBe(true);
  });

  it("should mark isExecuted when promise is awaited", async () => {
    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
    );

    const stepFn = vi.fn().mockResolvedValue("result");

    const stepPromise = stepHandler(stepFn);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect((stepPromise as DurablePromise<string>).isExecuted).toBe(false);

    await stepPromise;

    expect((stepPromise as DurablePromise<string>).isExecuted).toBe(true);
  });

  it("should handle step with name parameter", async () => {
    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
    );

    const stepFn = vi.fn().mockResolvedValue("named-result");

    const stepPromise = stepHandler("test-step", stepFn);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(stepFn).toHaveBeenCalled();

    const result = await stepPromise;
    expect(result).toBe("named-result");
  });

  it("should track running operations during execution", async () => {
    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createDefaultLogger(),
    );

    const stepFn = vi.fn().mockResolvedValue("result");

    const stepPromise = stepHandler(stepFn);

    await new Promise((resolve) => setTimeout(resolve, 10));

    await stepPromise;
  });
});
