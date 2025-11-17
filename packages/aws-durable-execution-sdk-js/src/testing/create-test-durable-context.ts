import { Context } from "aws-lambda";
import {
  Operation,
  CheckpointDurableExecutionResponse,
} from "@aws-sdk/client-lambda";
import {
  createDurableContext,
  DurableContextImpl,
} from "../context/durable-context/durable-context";
import { ExecutionState } from "../storage/storage";
import { TerminationManager } from "../termination-manager/termination-manager";
import { ExecutionContext, DurableExecutionMode } from "../types";
import { getStepData as getStepDataUtil } from "../utils/step-id-utils/step-id-utils";

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
  context: DurableContextImpl;
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
    getStepData(stepId: string): Operation | undefined {
      return getStepDataUtil(stepData, stepId);
    },
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

  const context = createDurableContext(
    executionContext,
    mockLambdaContext,
    options?.durableExecutionMode || DurableExecutionMode.ExecutionMode,
    options?.stepPrefix,
    "test-checkpoint-token",
  );

  return { context, storage, executionContext };
}
