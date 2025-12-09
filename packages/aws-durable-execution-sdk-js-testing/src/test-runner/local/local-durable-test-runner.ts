import {
  TestResult,
  InvokeRequest,
  DurableTestRunner,
} from "../types/durable-test-runner";
import { DurableOperation } from "../types/durable-operation";
import { DurableLambdaHandler } from "@aws/durable-execution-sdk-js";
import { LocalOperationStorage } from "./operations/local-operation-storage";
import { OperationWaitManager } from "./operations/operation-wait-manager";
import { OperationWithData } from "../common/operations/operation-with-data";
import { TestExecutionOrchestrator } from "./test-execution-orchestrator";
import { ResultFormatter } from "./result-formatter";
import { CheckpointWorkerManager } from "./worker/checkpoint-worker-manager";
import { IndexedOperations } from "../common/indexed-operations";
import { FunctionStorage } from "./operations/function-storage";
import {
  ILocalDurableTestRunnerExecutor,
  ILocalDurableTestRunnerFactory,
  LocalDurableTestRunnerParameters,
} from "./interfaces/durable-test-runner-factory";
import { DurableApiClient } from "../common/create-durable-api-client";
import { install, InstalledClock } from "@sinonjs/fake-timers";
import { Handler } from "aws-lambda";
import { ApiType } from "../../checkpoint-server/worker-api/worker-api-types";
import {
  SendDurableExecutionCallbackFailureRequest,
  SendDurableExecutionCallbackHeartbeatRequest,
} from "@aws-sdk/client-lambda";
import { CheckpointWorkerApiClient } from "./api-client/checkpoint-worker-api-client";

export type { LocalDurableTestRunnerParameters };

/**
 * Factory for creating LocalDurableTestRunner instances.
 * Used internally to support nested function execution during testing.
 * @internal
 */
export class LocalDurableTestRunnerFactory
  implements ILocalDurableTestRunnerFactory
{
  /**
   * Creates new runner instances for nested function execution.
   *
   * @typeParam T - The expected result type of the durable function
   * @param params - Configuration parameters for the test runner
   * @returns A new LocalDurableTestRunner instance
   */
  createRunner<T>(
    params: LocalDurableTestRunnerParameters,
  ): ILocalDurableTestRunnerExecutor<T> {
    return new LocalDurableTestRunner<T>(params);
  }
}

/**
 * Configuration parameters for setting up the LocalDurableTestRunner test environment.
 *
 * @public
 */
export interface LocalDurableTestRunnerSetupParameters {
  /**
   * Whether to enable time skipping using fake timers during test execution.
   *
   * When set to `true`, the test runner will install fake timers that allow tests
   * to skip over time-based operations like `setTimeout`, `setInterval`, `context.wait`,
   * and `context.step` retries without actually waiting for the specified duration.
   * This significantly speeds up test execution for workflows that involve delays
   * or timeouts.
   *
   * When set to `false` or undefined, real timers will be used and any time-based
   * operations will execute with their actual delays.
   *
   * @defaultValue false
   *
   * @example
   * ```typescript
   * // Enable time skipping for faster test execution
   * await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
   *
   * // Use real timers (default behavior)
   * await LocalDurableTestRunner.setupTestEnvironment({ skipTime: false });
   * // or simply:
   * await LocalDurableTestRunner.setupTestEnvironment();
   * ```
   *
   * @remarks
   * - The fake timers installation may fail in some environments, but this
   *   won't prevent the test setup from completing successfully
   * - All test runners created after setup will inherit this time skipping behavior
   */
  skipTime?: boolean;

  /**
   * Option to simulate checkpoint API delay. Adding delay can make tests behave more similarily
   * to the real world, where checkpoint API calls take longer. This can help with finding concurrency
   * bugs, race conditions, or other issues.
   */
  checkpointDelay?: number;
}

/**
 * Local test runner for durable executions that runs handlers in-process
 * with a local checkpoint server for development and testing scenarios.
 *
 * This test runner executes durable functions locally without requiring
 * AWS Lambda infrastructure, making it ideal for unit testing and local
 * development workflows.
 *
 * @typeParam ResultType - The expected result type of the durable function
 *
 * @example
 * ```typescript
 * import { LocalDurableTestRunner } from '@aws/durable-execution-sdk-js-testing';
 * import { withDurableExecution } from '@aws/durable-execution-sdk-js';
 *
 * const handler = withDurableExecution(async (input, context) => {
 *   const result = await context.step('process', () => processData(input));
 *   return result;
 * });
 *
 * const runner = new LocalDurableTestRunner({ handlerFunction: handler });
 *
 * const execution = await runner.run({ payload: { data: 'test' } });
 * const result = execution.getResult();
 * ```
 *
 * @public
 */
export class LocalDurableTestRunner<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TResult = any,
> implements DurableTestRunner<DurableOperation, TResult>
{
  private operationStorage: LocalOperationStorage;
  private waitManager: OperationWaitManager;
  private readonly resultFormatter: ResultFormatter<TResult>;
  private operationIndex: IndexedOperations;
  private static skipTime = false;
  private static fakeClock: InstalledClock | undefined;
  private readonly handlerFunction: DurableLambdaHandler;
  private readonly functionStorage: FunctionStorage;
  private readonly durableApi: DurableApiClient;

  /**
   * Creates a new LocalDurableTestRunner instance and starts the checkpoint server.
   *
   * @param params - Configuration parameters
   */
  constructor({ handlerFunction }: LocalDurableTestRunnerParameters) {
    this.operationIndex = new IndexedOperations([]);
    this.waitManager = new OperationWaitManager(this.operationIndex);
    this.resultFormatter = new ResultFormatter<TResult>();

    this.handlerFunction = handlerFunction;

    this.functionStorage = new FunctionStorage(
      new LocalDurableTestRunnerFactory(),
    );

    this.durableApi = LocalDurableTestRunner.createDurableApi();

    this.operationStorage = new LocalOperationStorage(
      this.waitManager,
      this.operationIndex,
      this.durableApi,
      this.waitManager.handleCheckpointReceived.bind(this.waitManager),
    );
  }

  private static createDurableApi(): DurableApiClient {
    return {
      sendCallbackSuccess: (request) =>
        CheckpointWorkerManager.getInstance().sendApiRequest(
          ApiType.SendDurableExecutionCallbackSuccess,
          request,
        ),
      sendCallbackFailure: (
        request: SendDurableExecutionCallbackFailureRequest,
      ) =>
        CheckpointWorkerManager.getInstance().sendApiRequest(
          ApiType.SendDurableExecutionCallbackFailure,
          request,
        ),
      sendCallbackHeartbeat: (
        request: SendDurableExecutionCallbackHeartbeatRequest,
      ) =>
        CheckpointWorkerManager.getInstance().sendApiRequest(
          ApiType.SendDurableExecutionCallbackHeartbeat,
          request,
        ),
    };
  }

  private static createCheckpointApiClient() {
    const workerManager = CheckpointWorkerManager.getInstance();
    return new CheckpointWorkerApiClient(workerManager);
  }

  /**
   * Executes the durable function and returns the result.
   * The method will not resolve until the handler function completes successfully
   * or throws an error.
   *
   * @param params - Optional parameters for the execution
   * @returns Promise that resolves with the execution result
   */
  async run(params?: InvokeRequest): Promise<TestResult<TResult>> {
    try {
      const orchestrator = new TestExecutionOrchestrator(
        this.handlerFunction,
        this.operationStorage,
        LocalDurableTestRunner.createCheckpointApiClient(),
        this.functionStorage,
        {
          enabled: LocalDurableTestRunner.skipTime,
          fakeClock: LocalDurableTestRunner.fakeClock,
        },
      );

      const lambdaResponse = await orchestrator.executeHandler(params);
      return this.resultFormatter.formatTestResult(
        lambdaResponse,
        this.operationStorage
          .getHistoryEvents()
          // TODO: the history events are not ordered because of the checkpoint polling loop
          // occurring in a different orderfrom the invocation completion.
          // We need to sort the events until the polling loop is fixed. Without the sort, InvocationCompleted
          // will come before some checkpoint events that occurred previously.
          .sort((a, b) => (a.EventId && b.EventId ? a.EventId - b.EventId : 0)),
        this.operationStorage,
      );
    } finally {
      this.waitManager.clearWaitingOperations();
    }
  }

  /**
   * Registers a durable function handler that can be invoked during durable execution testing.
   *
   * @param functionName - The name/ARN of the function that will be used in context.invoke() calls
   * @param durableHandler - The durable function handler created with withDurableExecution
   * @returns This LocalDurableTestRunner instance for method chaining
   *
   * @example
   * ```typescript
   * import { LocalDurableTestRunner } from '@aws/durable-execution-sdk-js-testing';
   * import { withDurableExecution } from '@aws/durable-execution-sdk-js';
   *
   * const testRunner = new LocalDurableTestRunner({
   *   handlerFunction: mainHandler
   * });
   *
   * // Register a durable function
   * const processWorkflow = withDurableExecution(async (input, context) => {
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
   * ```
   */
  registerDurableFunction(
    functionName: string,
    durableHandler: DurableLambdaHandler,
  ): this {
    this.functionStorage.registerDurableFunction(functionName, durableHandler);
    return this;
  }

  /**
   * Registers a function handler that can be invoked during durable execution testing.
   *
   * @param functionName - The name/ARN of the function that will be used in context.invoke() calls
   * @param handler - The function handler
   * @returns This LocalDurableTestRunner instance for method chaining
   *
   * @example
   * ```typescript
   * import { LocalDurableTestRunner } from '@aws/durable-execution-sdk-js-testing';
   * import { withDurableExecution } from '@aws/durable-execution-sdk-js';
   *
   * const testRunner = new LocalDurableTestRunner({
   *   handlerFunction: mainHandler
   * });
   *
   * // Register a function
   * const handler = async (input, context) => {
   *   const response = {
   *      status: 200
   *   }
   *   return response;
   * };
   *
   * testRunner.registerFunction('get-response', handler);
   *
   * // Chain multiple registrations
   * testRunner
   *   .registerFunction('workflow-a', workflowAHandler)
   *   .registerFunction('workflow-b', workflowBHandler)
   * ```
   */
  registerFunction(functionName: string, handler: Handler): this {
    this.functionStorage.registerFunction(functionName, handler);
    return this;
  }

  /**
   * Gets the first operation with the specified name.
   *
   * @typeParam TOperationResult - The expected result type of the operation
   * @param name - The name of the operation to retrieve
   * @param index - Optional index for operations with the same name (defaults to 0)
   * @returns An operation instance that can be used to inspect operation details
   */
  getOperation<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TOperationResult = any,
  >(name: string, index?: number): DurableOperation<TOperationResult> {
    const operation = new OperationWithData<TOperationResult>(
      this.waitManager,
      this.operationIndex,
      this.durableApi,
    );
    this.operationStorage.registerOperation({
      operation,
      params: {
        name,
        index,
      },
    });
    return operation;
  }

  /**
   * Gets an operation by its execution order index.
   *
   * @typeParam TOperationResult - The expected result type of the operation
   * @param index - The zero-based index of the operation in execution order
   * @returns An operation instance for the operation at the specified index
   */
  getOperationByIndex<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TOperationResult = any,
  >(index: number): DurableOperation<TOperationResult> {
    const operation = new OperationWithData<TOperationResult>(
      this.waitManager,
      this.operationIndex,
      this.durableApi,
    );
    this.operationStorage.registerOperation({
      operation,
      params: {
        index,
      },
    });
    return operation;
  }

  /**
   * Gets an operation by name and index when multiple operations have the same name.
   *
   * @typeParam TOperationResult - The expected result type of the operation
   * @param name - The name of the operation
   * @param index - The zero-based index among operations with the same name
   * @returns An operation instance for the specified named operation occurrence
   */
  getOperationByNameAndIndex<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TOperationResult = any,
  >(name: string, index: number): DurableOperation<TOperationResult> {
    const operation = new OperationWithData<TOperationResult>(
      this.waitManager,
      this.operationIndex,
      this.durableApi,
    );
    this.operationStorage.registerOperation({
      operation: operation,
      params: {
        name,
        index,
      },
    });
    return operation;
  }

  /**
   * Gets an operation by its unique identifier.
   *
   * @typeParam TOperationResult - The expected result type of the operation
   * @param id - The unique identifier of the operation
   * @returns An operation instance for the operation with the specified ID
   */
  getOperationById<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TOperationResult = any,
  >(id: string): DurableOperation<TOperationResult> {
    const operation = new OperationWithData<TOperationResult>(
      this.waitManager,
      this.operationIndex,
      this.durableApi,
    );
    this.operationStorage.registerOperation({
      operation,
      params: {
        id,
      },
    });
    return operation;
  }

  /**
   * Resets the test runner state, clearing all cached operations and history.
   *
   * This method should be called between test runs to ensure a clean state.
   * It clears the operation index, wait manager, and operation storage,
   * allowing the runner to be reused for multiple test executions.
   *
   * @example
   * ```typescript
   * beforeEach(() => {
   *   runner.reset();
   * });
   * ```
   */
  reset() {
    this.operationIndex = new IndexedOperations([]);
    this.waitManager = new OperationWaitManager(this.operationIndex);
    this.operationStorage = new LocalOperationStorage(
      this.waitManager,
      this.operationIndex,
      this.durableApi,
      this.waitManager.handleCheckpointReceived.bind(this.waitManager),
    );
  }

  /**
   * Sets up the test environment for local durable execution testing.
   *
   * This method initializes the checkpoint server, configures fake timers for time manipulation,
   * and prepares the environment for running durable function tests. This should be called
   * once before running any tests, typically in a test setup hook like `beforeAll`.
   *
   * @param params - Optional configuration parameters for the test environment
   *
   * @returns Promise that resolves when the test environment setup is complete
   *
   * @throws Will throw an error if the checkpoint server fails to start
   *
   * @example
   * ```typescript
   * import { LocalDurableTestRunner } from '@aws/durable-execution-sdk-js-testing';
   *
   * // Basic setup
   * beforeAll(async () => {
   *   await LocalDurableTestRunner.setupTestEnvironment();
   * });
   *
   * // Setup with time skipping enabled
   * beforeAll(async () => {
   *   await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
   * });
   * ```
   *
   * @remarks
   * - If fake timers are already installed (for example, if `jest.useFakeTimers()` was called previously),
   *   this function will throw an error and setup will not succeed.
   * - Must be paired with {@link LocalDurableTestRunner.teardownTestEnvironment} to properly clean up resources
   *
   * @see {@link LocalDurableTestRunner.teardownTestEnvironment} for cleaning up the test environment
   * @see {@link LocalDurableTestRunnerSetupParameters} for configuration options
   */
  static async setupTestEnvironment(
    params?: LocalDurableTestRunnerSetupParameters,
  ): Promise<void> {
    this.skipTime = params?.skipTime ?? false;
    if (this.skipTime) {
      this.fakeClock = install({
        shouldAdvanceTime: true,
        shouldClearNativeTimers: true,
        now: Date.now(),
      });
    }
    return CheckpointWorkerManager.getInstance({
      checkpointDelaySettings: params?.checkpointDelay,
    }).setup();
  }

  /**
   * Cleans up and tears down the test environment after durable execution testing.
   *
   * This method stops the checkpoint server, uninstalls fake timers, and performs
   * cleanup of resources that were initialized during test environment setup.
   * This should be called once after all tests have completed, typically in a
   * test cleanup hook like `afterAll`.
   *
   * @returns Promise that resolves when the test environment teardown is complete
   *
   * @throws Will throw an error if the checkpoint server fails to stop gracefully
   *
   * @example
   * ```typescript
   * import { LocalDurableTestRunner } from '@aws/durable-execution-sdk-js-testing';
   *
   * // Basic teardown
   * afterAll(async () => {
   *   await LocalDurableTestRunner.teardownTestEnvironment();
   * });
   *
   * // Complete test lifecycle
   * describe('Durable Function Tests', () => {
   *   beforeAll(async () => {
   *     await LocalDurableTestRunner.setupTestEnvironment();
   *   });
   *
   *   afterAll(async () => {
   *     await LocalDurableTestRunner.teardownTestEnvironment();
   *   });
   *
   *   it('should execute durable function', async () => {
   *     // test implementation
   *   });
   * });
   * ```
   *
   * @remarks
   * - This method safely uninstalls fake timers that were installed during setup if
   *    skipTime was enabled.
   * - Must be called after {@link LocalDurableTestRunner.setupTestEnvironment} to prevent resource leaks
   * - Failure to call this method may leave the checkpoint server running and
   *   consume system resources
   *
   * @see {@link LocalDurableTestRunner.setupTestEnvironment} for initializing the test environment
   */
  static async teardownTestEnvironment() {
    this.fakeClock?.uninstall();
    this.fakeClock = undefined;
    return CheckpointWorkerManager.getInstance().teardown();
  }
}
