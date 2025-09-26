import {
  TestResult,
  InvokeRequest,
  DurableTestRunner,
} from "../durable-test-runner";
import {
  DurableExecutionInvocationInput,
  LambdaHandler,
  withDurableFunctions,
} from "@aws/durable-execution-sdk-js";
import { LocalOperationStorage } from "./operations/local-operation-storage";
import { OperationWaitManager } from "./operations/operation-wait-manager";
import { MockOperation } from "./operations/mock-operation";
import { TestExecutionOrchestrator } from "./test-execution-orchestrator";
import { ResultFormatter } from "./result-formatter";
import { CheckpointApiClient } from "./api-client/checkpoint-api-client";
import { CheckpointServerWorkerManager } from "./checkpoint-server-worker-manager";
import { IndexedOperations } from "../common/indexed-operations";
import { Scheduler } from "./orchestration/scheduler";
import { FunctionStorage } from "./operations/function-storage";
import { Handler } from "aws-lambda";
import {
  IDurableTestRunnerExecutor,
  IDurableTestRunnerFactory,
} from "./interfaces/durable-test-runner-factory";

export type LocalTestRunnerHandlerFunction = ReturnType<
  typeof withDurableFunctions
>;

/**
 * Configuration parameters for LocalDurableTestRunner.
 */
export interface LocalDurableTestRunnerParameters {
  /** The handler function to run the execution on */
  handlerFunction: LocalTestRunnerHandlerFunction;
  /**
   * Whether to skip wait/retry intervals by using minimal delays.
   * Will be overridden by calling `skipTime` on individual mocked steps.
   * @default false
   */
  skipTime?: boolean;
}

export class LocalDurableTestRunnerFactory
  implements IDurableTestRunnerFactory
{
  /**
   * Creates new runner instances for nested function execution
   */
  createRunner<T>(
    handlerFunction: LambdaHandler<DurableExecutionInvocationInput>,
    skipTime: boolean
  ): IDurableTestRunnerExecutor<T> {
    return new LocalDurableTestRunner<T>({
      handlerFunction,
      skipTime,
    });
  }
}

/**
 * Local test runner for durable executions that runs handlers in-process
 * with a local checkpoint server for development and testing scenarios.
 */
export class LocalDurableTestRunner<ResultType>
  implements DurableTestRunner<MockOperation, ResultType>
{
  private operationStorage: LocalOperationStorage;
  private readonly waitManager: OperationWaitManager;
  private readonly resultFormatter: ResultFormatter<ResultType>;
  private operationIndex: IndexedOperations;
  private readonly skipTime: boolean;
  private readonly handlerFunction: LocalDurableTestRunnerParameters["handlerFunction"];
  private readonly functionStorage: FunctionStorage;

  /**
   * Creates a new LocalDurableTestRunner instance and starts the checkpoint server.
   *
   * @param params Configuration parameters
   * @param params.handlerFunction The durable function handler to execute
   * @param params.skipTime If true, wait operations use minimal delay (1ms) instead of actual wait times
   */
  constructor({
    handlerFunction,
    skipTime = false,
  }: LocalDurableTestRunnerParameters) {
    this.waitManager = new OperationWaitManager();
    this.operationIndex = new IndexedOperations([]);
    this.operationStorage = new LocalOperationStorage(
      this.waitManager,
      this.operationIndex,
      this.waitManager.handleCheckpointReceived.bind(this.waitManager)
    );
    this.resultFormatter = new ResultFormatter<ResultType>();

    this.skipTime = skipTime;
    this.handlerFunction = handlerFunction;

    this.functionStorage = new FunctionStorage(
      new LocalDurableTestRunnerFactory()
    );
  }

  /**
   * Executes the durable function and returns the result.
   * The method will not resolve until the handler function completes successfully
   * or throws an error.
   *
   * @param params Optional parameters for the execution
   * @returns Promise that resolves with the execution result
   */
  async run(params?: InvokeRequest): Promise<TestResult<ResultType>> {
    try {
      const serverInfo =
        CheckpointServerWorkerManager.getInstance().getServerInfo();
      if (!serverInfo) {
        throw new Error(
          "Could not find checkpoint server info. Did you call LocalDurableTestRunner.setupTestEnvironment()?"
        );
      }

      const orchestrator = new TestExecutionOrchestrator(
        this.handlerFunction,
        this.operationStorage,
        new CheckpointApiClient(serverInfo.url),
        new Scheduler(),
        this.functionStorage,
        this.skipTime
      );

      const lambdaResponse = await orchestrator.executeHandler(params);
      return this.resultFormatter.formatTestResult(
        lambdaResponse,
        this.operationStorage.getHistoryEvents(),
        this.operationStorage,
        orchestrator.getInvocations()
      );
    } finally {
      this.waitManager.clearWaitingOperations();
    }
  }

  /**
   * Registers a standard Lambda function handler that can be invoked during durable execution testing.
   * Non-durable functions are executed directly without durable execution capabilities.
   *
   * @param functionName - The name/ARN of the function that will be used in context.invoke() calls
   * @param handler - The standard Lambda function handler
   * @returns This LocalDurableTestRunner instance for method chaining
   *
   * @example
   * ```typescript
   * import { LocalDurableTestRunner } from '@aws/durable-execution-sdk-js-testing';
   * import { withDurableFunctions } from '@aws/durable-execution-sdk-js';
   *
   * const testRunner = new LocalDurableTestRunner({
   *   handlerFunction: mainHandler
   * });
   *
   * // Register a non-durable function
   * testRunner.registerFunction('user-service', async (event) => {
   *   return { userId: event.id, name: 'John Doe' };
   * });
   *
   * // Chain multiple registrations
   * testRunner
   *   .registerFunction('email-service', emailHandler)
   *   .registerFunction('notification-service', notificationHandler);
   * ```
   */
  registerFunction(functionName: string, handler: Handler): this {
    this.functionStorage.registerFunction(functionName, handler);
    return this;
  }

  /**
   * Registers a durable function handler that can be invoked during durable execution testing.
   * Durable functions can use durable execution features like steps, waits, and retries.
   *
   * @param functionName - The name/ARN of the function that will be used in context.invoke() calls
   * @param durableHandler - The durable function handler created with withDurableFunctions
   * @returns This LocalDurableTestRunner instance for method chaining
   *
   * @example
   * ```typescript
   * import { LocalDurableTestRunner } from '@aws/durable-execution-sdk-js-testing';
   * import { withDurableFunctions } from '@aws/durable-execution-sdk-js';
   *
   * const testRunner = new LocalDurableTestRunner({
   *   handlerFunction: mainHandler
   * });
   *
   * // Register a durable function
   * const processWorkflow = withDurableFunctions(async (input, context) => {
   *   const step1 = await context.step('validate', () => validate(input));
   *   const step2 = await context.step('process', () => process(step1));
   *   return step2;
   * });
   *
   * testRunner.registerDurableFunction('process-workflow', processWorkflow);
   *
   * // Chain multiple registrations
   * testRunner
   *   .registerDurableFunction('workflow-a', workflowAHandler)
   *   .registerDurableFunction('workflow-b', workflowBHandler)
   *   .registerFunction('helper-function', helperHandler);
   * ```
   */
  registerDurableFunction(
    functionName: string,
    durableHandler: LambdaHandler<DurableExecutionInvocationInput>
  ): this {
    this.functionStorage.registerDurableFunction(functionName, durableHandler);
    return this;
  }

  // Inherited methods from DurableTestRunner
  getOperation<OperationResult>(
    name: string,
    index?: number
  ): MockOperation<OperationResult> {
    const mockOperation = new MockOperation<OperationResult>(
      {
        name,
        index,
      },
      this.waitManager,
      this.operationIndex
    );
    this.operationStorage.registerOperation(mockOperation);
    return mockOperation;
  }

  getOperationByIndex<OperationResult>(
    index: number
  ): MockOperation<OperationResult> {
    const mockOperation = new MockOperation<OperationResult>(
      {
        index,
      },
      this.waitManager,
      this.operationIndex
    );
    this.operationStorage.registerOperation(mockOperation);
    return mockOperation;
  }

  getOperationByNameAndIndex<OperationResult>(
    name: string,
    index: number
  ): MockOperation<OperationResult> {
    const mockOperation = new MockOperation<OperationResult>(
      {
        name,
        index,
      },
      this.waitManager,
      this.operationIndex
    );
    this.operationStorage.registerOperation(mockOperation);
    return mockOperation;
  }

  getOperationById<OperationResult>(
    id: string
  ): MockOperation<OperationResult> {
    const mockOperation = new MockOperation<OperationResult>(
      {
        id,
      },
      this.waitManager,
      this.operationIndex
    );
    this.operationStorage.registerOperation(mockOperation);
    return mockOperation;
  }

  reset() {
    this.operationIndex = new IndexedOperations([]);
    this.operationStorage = new LocalOperationStorage(
      this.waitManager,
      this.operationIndex,
      this.waitManager.handleCheckpointReceived.bind(this.waitManager)
    );
  }

  static async setupTestEnvironment() {
    return CheckpointServerWorkerManager.getInstance().setup();
  }

  static async teardownTestEnvironment() {
    return CheckpointServerWorkerManager.getInstance().teardown();
  }
}
