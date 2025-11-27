import {
  TestResult,
  InvokeRequest,
  DurableTestRunner,
} from "../durable-test-runner";
import { DurableLambdaHandler } from "@aws/durable-execution-sdk-js";
import { LocalOperationStorage } from "./operations/local-operation-storage";
import { OperationWaitManager } from "./operations/operation-wait-manager";
import { OperationWithData } from "../common/operations/operation-with-data";
import { TestExecutionOrchestrator } from "./test-execution-orchestrator";
import { ResultFormatter } from "./result-formatter";
import { CheckpointApiClient } from "./api-client/checkpoint-api-client";
import { CheckpointServerWorkerManager } from "./checkpoint-server-worker-manager";
import { IndexedOperations } from "../common/indexed-operations";
import { FunctionStorage } from "./operations/function-storage";
import {
  ILocalDurableTestRunnerExecutor,
  ILocalDurableTestRunnerFactory,
  LocalDurableTestRunnerParameters,
} from "./interfaces/durable-test-runner-factory";
import {
  createDurableApiClient,
  DurableApiClient,
} from "../common/create-durable-api-client";
import { getDurableExecutionsClient } from "./api-client/durable-executions-client";
import { install, InstalledClock } from "@sinonjs/fake-timers";
import { Handler } from "aws-lambda";

export type LocalTestRunnerHandlerFunction = DurableLambdaHandler;

export type { LocalDurableTestRunnerParameters };

export class LocalDurableTestRunnerFactory
  implements ILocalDurableTestRunnerFactory
{
  /**
   * Creates new runner instances for nested function execution
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
}

/**
 * Local test runner for durable executions that runs handlers in-process
 * with a local checkpoint server for development and testing scenarios.
 */
export class LocalDurableTestRunner<ResultType>
  implements DurableTestRunner<OperationWithData, ResultType>
{
  private operationStorage: LocalOperationStorage;
  private waitManager: OperationWaitManager;
  private readonly resultFormatter: ResultFormatter<ResultType>;
  private operationIndex: IndexedOperations;
  static skipTime = false;
  static fakeClock: InstalledClock | undefined;
  private readonly handlerFunction: DurableLambdaHandler;
  private readonly functionStorage: FunctionStorage;
  private readonly durableApi: DurableApiClient;

  /**
   * Creates a new LocalDurableTestRunner instance and starts the checkpoint server.
   *
   * @param params Configuration parameters
   * @param params.handlerFunction The durable function handler to execute
   */
  constructor({ handlerFunction }: LocalDurableTestRunnerParameters) {
    this.operationIndex = new IndexedOperations([]);
    this.waitManager = new OperationWaitManager(this.operationIndex);
    this.resultFormatter = new ResultFormatter<ResultType>();

    this.handlerFunction = handlerFunction;

    this.functionStorage = new FunctionStorage(
      new LocalDurableTestRunnerFactory(),
    );

    this.durableApi = createDurableApiClient(() => {
      const serverInfo = LocalDurableTestRunner.getCheckpointServerInfo();
      return getDurableExecutionsClient(serverInfo.url);
    });

    this.operationStorage = new LocalOperationStorage(
      this.waitManager,
      this.operationIndex,
      this.durableApi,
      this.waitManager.handleCheckpointReceived.bind(this.waitManager),
    );
  }

  private static getCheckpointServerInfo() {
    const serverInfo =
      CheckpointServerWorkerManager.getInstance().getServerInfo();
    if (!serverInfo) {
      throw new Error(
        "Could not find checkpoint server info. Did you call LocalDurableTestRunner.setupTestEnvironment()?",
      );
    }
    return serverInfo;
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
      const serverInfo = LocalDurableTestRunner.getCheckpointServerInfo();

      process.env.DURABLE_LOCAL_RUNNER_REGION = "us-west-2";
      process.env.DURABLE_LOCAL_RUNNER_ENDPOINT = serverInfo.url;
      process.env.DURABLE_LOCAL_RUNNER_CREDENTIALS = JSON.stringify({
        accessKeyId: "placeholder-accessKeyId",
        secretAccessKey: "placeholder-secretAccessKey",
        sessionToken: "placeholder-sessionToken",
      });

      const orchestrator = new TestExecutionOrchestrator(
        this.handlerFunction,
        this.operationStorage,
        new CheckpointApiClient(serverInfo.url),
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

  // Inherited methods from DurableTestRunner
  getOperation<OperationResult>(
    name: string,
    index?: number,
  ): OperationWithData<OperationResult> {
    const operation = new OperationWithData<OperationResult>(
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

  getOperationByIndex<OperationResult>(
    index: number,
  ): OperationWithData<OperationResult> {
    const operation = new OperationWithData<OperationResult>(
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

  getOperationByNameAndIndex<OperationResult>(
    name: string,
    index: number,
  ): OperationWithData<OperationResult> {
    const operation = new OperationWithData<OperationResult>(
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

  getOperationById<OperationResult>(
    id: string,
  ): OperationWithData<OperationResult> {
    const operation = new OperationWithData<OperationResult>(
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
   * @param params.skipTime - Whether to enable time skipping using fake timers. When true,
   * allows tests to skip over time-based operations like `setTimeout`, `setInterval`, `context.wait`,
   * and `context.step` retries without actually waiting for the specified duration.
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
   * - Must be paired with {@link teardownTestEnvironment} to properly clean up resources
   *
   * @see {@link teardownTestEnvironment} for cleaning up the test environment
   * @see {@link LocalDurableTestRunnerSetupParameters} for configuration options
   */
  static async setupTestEnvironment(
    params?: LocalDurableTestRunnerSetupParameters,
  ) {
    this.skipTime = params?.skipTime ?? false;
    if (this.skipTime) {
      this.fakeClock = install({
        shouldAdvanceTime: true,
        shouldClearNativeTimers: true,
        now: Date.now(),
      });
    }
    return CheckpointServerWorkerManager.getInstance().setup();
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
   * - Must be called after {@link setupTestEnvironment} to prevent resource leaks
   * - Failure to call this method may leave the checkpoint server running and
   *   consume system resources
   *
   * @see {@link setupTestEnvironment} for initializing the test environment
   */
  static async teardownTestEnvironment() {
    this.fakeClock?.uninstall();
    this.fakeClock = undefined;
    return CheckpointServerWorkerManager.getInstance().teardown();
  }
}
