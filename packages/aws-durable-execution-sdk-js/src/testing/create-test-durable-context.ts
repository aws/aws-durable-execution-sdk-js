import { vi } from "vitest";
import { Context } from "aws-lambda";
import { EventEmitter } from "events";
import { Operation, CheckpointDurableExecutionResponse } from "../types/wire";
import {
  createDurableContext,
  DurableContextImpl,
  DurableExecution,
} from "../context/durable-context/durable-context";
import { DurableExecutionClient } from "../types/durable-execution";
import { TerminationManager } from "../termination-manager/termination-manager";
import { Checkpoint } from "../utils/checkpoint/checkpoint-helper";
import {
  ExecutionContext,
  DurableExecutionMode,
  DurableLogger,
} from "../types";
import { getStepData as getStepDataUtil } from "../utils/step-id-utils/step-id-utils";
import { createDefaultLogger } from "../utils/logger/default-logger";

/**
 * In-memory storage for testing - no API calls
 */
class InMemoryStorage implements DurableExecutionClient {
  private operations: Operation[] = [];

  async getExecutionState(): Promise<{ Operations: Operation[] }> {
    return { Operations: this.operations };
  }

  async checkpoint(): Promise<CheckpointDurableExecutionResponse> {
    return { NewExecutionState: undefined };
  }

  addOperation(operation: Operation): void {
    this.operations.push(operation);
  }

  getOperations(): Operation[] {
    return this.operations;
  }
}

/**
 * Creates a real DurableContext with mocked storage for integration testing
 */
export function createTestDurableContext(options?: {
  stepPrefix?: string;
  durableExecutionMode?: DurableExecutionMode;
  existingOperations?: Operation[];
  lambdaContext?: Partial<Context>;
  plugin?: Partial<DurableExecution["plugin"]>;
}): {
  context: DurableContextImpl<DurableLogger>;
  storage: InMemoryStorage;
  executionContext: ExecutionContext;
} {
  const storage = new InMemoryStorage();

  // Add existing operations if provided
  if (options?.existingOperations) {
    options.existingOperations.forEach((op) => {
      storage.addOperation(op);
    });
  }

  const stepData: Record<string, Operation> = {};
  storage.getOperations().forEach((op) => {
    if (op.Id) {
      stepData[op.Id] = op;
    }
  });

  const executionContext: ExecutionContext = {
    durableExecutionClient: storage,
    _stepData: stepData,
    terminationManager: new TerminationManager(),
    durableExecutionArn:
      "arn:aws:lambda:us-east-1:123456789012:durable-execution:test",
    pendingCompletions: new Set<string>(),
    getStepData(stepId: string): Operation | undefined {
      return getStepDataUtil(stepData, stepId);
    },
    isOperationUpdatedBetweenInvocation(): boolean {
      return false;
    },
    requestId: "mock-request-id",
    getRemainingTimeMs: (): number => Infinity,
    tenantId: undefined,
  };

  const mockLambdaContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: "test-function",
    functionVersion: "1",
    invokedFunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:test",
    memoryLimitInMB: "128",
    awsRequestId: "test-request-id",
    logGroupName: "/aws/lambda/test",
    logStreamName: "test-stream",
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
    ...options?.lambdaContext,
  };

  // Create a mock DurableExecution with mock checkpoint for tests
  const mockCheckpoint: Checkpoint = {
    checkpoint: vi.fn().mockResolvedValue(undefined),
    forceCheckpoint: vi.fn().mockResolvedValue(undefined),
    force: vi.fn().mockResolvedValue(undefined),
    setTerminating: vi.fn(),
    hasPendingAncestorCompletion: vi.fn().mockReturnValue(false),
    waitForQueueCompletion: vi.fn().mockResolvedValue(undefined),
    markAncestorFinished: vi.fn(),
    // New lifecycle methods (stubs)
    markOperationState: vi.fn(),
    waitForRetryTimer: vi.fn().mockResolvedValue(undefined),
    waitForStatusChange: vi.fn().mockResolvedValue(undefined),
    markOperationAwaited: vi.fn(),
    getOperationState: vi.fn().mockReturnValue(undefined),
    getAllOperations: vi.fn().mockReturnValue(new Map()),
  };

  const mockDurableExecution = {
    checkpointManager: mockCheckpoint,
    stepDataEmitter: new EventEmitter(),
    setTerminating: vi.fn(),
    plugin: options?.plugin,
  };

  const context = createDurableContext<DurableLogger>(
    executionContext,
    mockLambdaContext,
    options?.durableExecutionMode || DurableExecutionMode.ExecutionMode,
    createDefaultLogger(),
    options?.stepPrefix,
    mockDurableExecution as unknown as DurableExecution, // Cast to avoid type issues with mock
  );

  return { context, storage, executionContext };
}
