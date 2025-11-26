import { Context } from "aws-lambda";
import { EventEmitter } from "events";
import {
  Operation,
  CheckpointDurableExecutionResponse,
} from "@aws-sdk/client-lambda";
import {
  createDurableContext,
  DurableContextImpl,
  DurableExecution,
} from "../context/durable-context/durable-context";
import { ExecutionState } from "../storage/storage";
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
class InMemoryStorage implements ExecutionState {
  private operations: Operation[] = [];

  async getStepData(): Promise<{ Operations: Operation[] }> {
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
}): {
  context: DurableContextImpl<DurableLogger>;
  storage: InMemoryStorage;
  executionContext: ExecutionContext;
} {
  const storage = new InMemoryStorage();

  // Add existing operations if provided
  if (options?.existingOperations) {
    options.existingOperations.forEach((op) => storage.addOperation(op));
  }

  const stepData: Record<string, Operation> = {};
  storage.getOperations().forEach((op) => {
    if (op.Id) {
      stepData[op.Id] = op;
    }
  });

  const executionContext: ExecutionContext = {
    state: storage,
    _stepData: stepData,
    terminationManager: new TerminationManager(),
    durableExecutionArn:
      "arn:aws:lambda:us-east-1:123456789012:durable-execution:test",
    pendingCompletions: new Set<string>(),
    getStepData(stepId: string): Operation | undefined {
      return getStepDataUtil(stepData, stepId);
    },
    requestId: "mock-request-id",
    tenantId: undefined,
    activeOperationsTracker: undefined,
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
    checkpoint: jest.fn().mockResolvedValue(undefined),
    forceCheckpoint: jest.fn().mockResolvedValue(undefined),
    force: jest.fn().mockResolvedValue(undefined),
    setTerminating: jest.fn(),
    hasPendingAncestorCompletion: jest.fn().mockReturnValue(false),
    waitForQueueCompletion: jest.fn().mockResolvedValue(undefined),
  };

  const mockDurableExecution = {
    checkpointManager: mockCheckpoint,
    stepDataEmitter: new EventEmitter(),
    setTerminating: jest.fn(),
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
