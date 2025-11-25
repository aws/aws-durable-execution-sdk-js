import { createInvokeHandler } from "./invoke-handler";
import { ExecutionContext } from "../../types";
import { EventEmitter } from "events";
import { DurablePromise } from "../../types/durable-promise";
import { OperationStatus } from "@aws-sdk/client-lambda";

// Mock dependencies
jest.mock("../../utils/checkpoint/checkpoint-manager");
jest.mock("../../utils/termination-helper/termination-helper");
jest.mock("../../utils/logger/logger");
jest.mock("../../errors/serdes-errors/serdes-errors");
jest.mock("../../utils/wait-before-continue/wait-before-continue");

import { terminate } from "../../utils/termination-helper/termination-helper";
import { log } from "../../utils/logger/logger";
import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";

const mockTerminate = terminate as jest.MockedFunction<typeof terminate>;
const _mockLog = log as jest.MockedFunction<typeof log>;
const mockSafeSerialize = safeSerialize as jest.MockedFunction<
  typeof safeSerialize
>;
const mockSafeDeserialize = safeDeserialize as jest.MockedFunction<
  typeof safeDeserialize
>;

describe("Invoke Handler Two-Phase Execution", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: any;
  let createStepId: () => string;
  let hasRunningOperations: () => boolean;
  let getOperationsEmitter: () => EventEmitter;
  let stepIdCounter = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    stepIdCounter = 0;

    mockContext = {
      getStepData: jest.fn().mockReturnValue(null),
      terminationManager: {
        terminate: jest.fn(),
      },
      durableExecutionArn: "test-arn",
    } as any;

    mockCheckpoint = {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      force: jest.fn().mockResolvedValue(undefined),
    };

    createStepId = (): string => `step-${++stepIdCounter}`;
    hasRunningOperations = jest.fn().mockReturnValue(false) as () => boolean;
    getOperationsEmitter = (): EventEmitter => new EventEmitter();

    // Mock serdes functions
    mockSafeSerialize.mockResolvedValue('{"serialized":"data"}');
    mockSafeDeserialize.mockResolvedValue({ result: "success" });

    // Mock terminate to throw (simulating termination)
    mockTerminate.mockImplementation(() => {
      throw new Error("TERMINATION_FOR_TEST");
    });
  });

  it("should execute invoke logic in phase 1 without terminating", async () => {
    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      hasRunningOperations,
      getOperationsEmitter,
    );

    // Phase 1: Create the promise - this executes the logic but doesn't terminate
    const invokePromise = invokeHandler("test-function", { input: "data" });

    // Wait for phase 1 to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should return a DurablePromise
    expect(invokePromise).toBeInstanceOf(DurablePromise);

    // Phase 1 should have executed (checkpoint called)
    expect(mockCheckpoint.checkpoint).toHaveBeenCalled();
    expect(mockContext.getStepData).toHaveBeenCalled();
  });

  it("should execute invoke logic again in phase 2 when awaited", async () => {
    // Mock stepData to return STARTED status
    mockContext.getStepData = jest
      .fn()
      .mockReturnValueOnce(null) // Phase 1 - no stepData
      .mockReturnValue({ Status: OperationStatus.STARTED }); // Phase 2 - STARTED

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      hasRunningOperations,
      getOperationsEmitter,
    );

    // Phase 1: Create the promise
    const invokePromise = invokeHandler("test-function", { input: "data" });

    // Wait for phase 1 to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Phase 2: Await the promise - this should execute again and terminate
    await expect(invokePromise).rejects.toThrow("TERMINATION_FOR_TEST");

    // Phase 2 execution should have happened
    expect((invokePromise as DurablePromise<any>).isExecuted).toBe(true);
    expect(mockTerminate).toHaveBeenCalled();
  });

  it("should work correctly with Promise.race", async () => {
    // Mock stepData to return STARTED status for termination
    mockContext.getStepData = jest.fn().mockReturnValue({
      Status: OperationStatus.STARTED,
    });

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      hasRunningOperations,
      getOperationsEmitter,
    );

    // Phase 1: Create multiple invoke promises
    const invoke1 = invokeHandler("function1", { input: "data1" });
    const invoke2 = invokeHandler("function2", { input: "data2" });

    // Neither should be executed yet
    expect((invoke1 as DurablePromise<any>).isExecuted).toBe(false);
    expect((invoke2 as DurablePromise<any>).isExecuted).toBe(false);

    // Phase 2: Use Promise.race - this should trigger execution
    await expect(Promise.race([invoke1, invoke2])).rejects.toThrow(
      "TERMINATION_FOR_TEST",
    );

    // At least one should be executed
    const executed =
      (invoke1 as DurablePromise<any>).isExecuted ||
      (invoke2 as DurablePromise<any>).isExecuted;
    expect(executed).toBe(true);
  });

  it("should return cached result without re-execution when stepData exists", async () => {
    // Mock stepData to exist with SUCCEEDED status
    mockContext.getStepData = jest.fn().mockReturnValue({
      Status: OperationStatus.SUCCEEDED,
      ChainedInvokeDetails: {
        Result: '{"cached":"result"}',
      },
    });

    mockSafeDeserialize.mockResolvedValue({ cached: "result" });

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      hasRunningOperations,
      getOperationsEmitter,
    );

    // Phase 1: Create the promise
    const invokePromise = invokeHandler("test-function", { input: "data" });

    // Wait for phase 1 to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should not checkpoint since stepData exists
    expect(mockCheckpoint.checkpoint).not.toHaveBeenCalled();

    // Phase 2: Await the promise - should return cached result
    const result = await invokePromise;
    expect(result).toEqual({ cached: "result" });

    // Should have called deserialize
    expect(mockSafeDeserialize).toHaveBeenCalledWith(
      expect.anything(),
      '{"cached":"result"}',
      "step-1",
      undefined,
      mockContext.terminationManager,
      "test-arn",
    );
  });

  it("should only checkpoint once when stepData doesn't exist", async () => {
    // Mock stepData to not exist initially, then exist after checkpoint
    mockContext.getStepData = jest
      .fn()
      .mockReturnValueOnce(null) // Phase 1 - no stepData
      .mockReturnValue({ Status: OperationStatus.STARTED }); // After checkpoint

    const invokeHandler = createInvokeHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      hasRunningOperations,
      getOperationsEmitter,
    );

    // Phase 1: Create the promise
    const invokePromise = invokeHandler("test-function", { input: "data" });

    // Wait for phase 1 to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Checkpoint should have been called once in phase 1
    expect(mockCheckpoint.checkpoint).toHaveBeenCalledTimes(1);

    // Phase 2: Await the promise
    await expect(invokePromise).rejects.toThrow("TERMINATION_FOR_TEST");

    // Checkpoint should still only be called once (phase 1 did the checkpoint)
    expect(mockCheckpoint.checkpoint).toHaveBeenCalledTimes(1);
  });
});
