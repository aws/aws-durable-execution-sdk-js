import {
  TestResult,
  InvokeRequest,
  DurableTestRunner,
} from "../durable-test-runner";
import { withDurableFunctions } from "aws-durable-execution-sdk-js";
import { LocalOperationStorage } from "./operations/local-operation-storage";
import { OperationWaitManager } from "./operations/operation-wait-manager";
import { MockOperation } from "./operations/mock-operation";
import { TestExecutionOrchestrator } from "./test-execution-orchestrator";
import { ResultFormatter } from "./result-formatter";
import { CheckpointApiClient } from "./api-client/checkpoint-api-client";
import { CheckpointServerWorkerManager } from "./checkpoint-server-worker-manager";
import { IndexedOperations } from "../common/indexed-operations";
import { Scheduler } from "./orchestration/scheduler";

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
