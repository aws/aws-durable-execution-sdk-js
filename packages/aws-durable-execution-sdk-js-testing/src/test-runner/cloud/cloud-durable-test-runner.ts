import {
  InvokeCommand,
  LambdaClient,
  GetDurableExecutionHistoryCommand,
  InvocationType,
} from "@aws-sdk/client-lambda";
import { IndexedOperations } from "../common/indexed-operations";
import { OperationStorage } from "../common/operation-storage";
import { OperationEvents } from "../common/operations/operation-with-data";
import {
  DurableTestRunner,
  InvokeRequest,
  TestResult,
} from "../types/durable-test-runner";
import { DurableOperation } from "../types/durable-operation";
import { OperationWaitManager } from "../local/operations/operation-wait-manager";
import { ResultFormatter } from "../local/result-formatter";
import { HistoryPoller } from "./history-poller";
import { TestExecutionState } from "../common/test-execution-state";
import {
  createDurableApiClient,
  DurableApiClient,
} from "../common/create-durable-api-client";
import { CloudOperation } from "./operations/cloud-operation";

/**
 * Options for the cloud durable test runner.
 * @public
 */
export interface CloudDurableTestRunnerConfig {
  /**
   * Interval with wich the APIs for GetDurableExecutionHistory and GetDurableExecution
   * are fetched from the API.
   *
   * @defaultValue 1000ms
   */
  pollInterval?: number;
  /**
   * Invocation type for the Lambda invocation.
   *
   * @defaultValue {@link InvocationType.RequestResponse}
   */
  invocationType?: InvocationType;
}

/**
 * Parameters for creating a CloudDurableTestRunner instance.
 * @public
 */
export interface CloudDurableTestRunnerParameters {
  /** The name or ARN of the Lambda function to invoke for testing */
  functionName: string;
  /**
   * Optional AWS Lambda client
   * @defaultValue new LambdaClient()
   */
  client?: LambdaClient;
  /** Optional configuration for the test runner */
  config?: CloudDurableTestRunnerConfig;
}

/**
 * A test runner for durable execution functions running in the AWS cloud.
 * This runner invokes Lambda functions and polls for execution history to provide
 * testing capabilities for durable operations.
 *
 *
 * @example
 * ```typescript
 * const runner = new CloudDurableTestRunner({
 *   functionName: 'my-durable-function',
 * });
 *
 * const execution = await runner.run({ payload: { input: 'test' } });
 * const result = execution.getResult();
 * const stepOperation = runner.getOperation('myStep');
 * ```
 *
 * @example
 * ```typescript
 * const runner = new CloudDurableTestRunner({
 *   functionName: 'my-durable-function',
 *   client: new LambdaClient({ region: 'us-east-1' }),
 *   config: { pollInterval: 500 }
 * });
 *
 * const execution = await runner.run({ payload: { input: 'test' } });
 * const result = execution.getResult();
 * const stepOperation = runner.getOperation('myStep');
 * ```
 *
 * @public
 */
export class CloudDurableTestRunner<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TResult = any,
> implements DurableTestRunner<DurableOperation, TResult>
{
  private readonly functionName: string;
  private readonly client: LambdaClient;
  private readonly formatter = new ResultFormatter<TResult>();
  private indexedOperations = new IndexedOperations([]);
  private waitManager = new OperationWaitManager(this.indexedOperations);
  private operationStorage: OperationStorage;
  private readonly apiClient: DurableApiClient;
  private readonly config: Required<CloudDurableTestRunnerConfig>;

  /**
   * Creates a new CloudDurableTestRunner instance.
   *
   * @param params - Configuration parameters for the test runner
   */
  constructor({
    functionName,
    client,
    config,
  }: CloudDurableTestRunnerParameters) {
    this.client = client ?? new LambdaClient();
    this.apiClient = createDurableApiClient(() => this.client);
    this.functionName = functionName;
    this.operationStorage = new OperationStorage(
      this.waitManager,
      this.indexedOperations,
      this.apiClient,
    );
    this.config = {
      pollInterval: 1000,
      invocationType: InvocationType.RequestResponse,
      ...config,
    };
  }

  /**
   * Runs the durable function and returns the test result.
   *
   * This method invokes the Lambda function, polls for execution history,
   * and returns a comprehensive test result containing the function output
   * and all operation details.
   *
   * @param params - Optional parameters for the function invocation
   * @returns A promise that resolves to the test result containing function output and operation history
   * @throws Will throw an error if no execution ARN is returned from the Lambda invocation which can occur
   * if the function is not a durable function.
   *
   * @example
   * ```typescript
   * const result = await runner.run({
   *   payload: { userId: '123', action: 'process' }
   * });
   * console.log('Function result:', result.getResult());
   * console.log('Operations count:', result.getOperations().length);
   * ```
   */
  async run(params?: InvokeRequest): Promise<TestResult<TResult>> {
    const asyncInvokeResult = await this.client.send(
      new InvokeCommand({
        FunctionName: this.functionName,
        Payload: params?.payload ? JSON.stringify(params.payload) : undefined,
        InvocationType: this.config.invocationType,
      }),
    );

    const durableExecutionArn = asyncInvokeResult.DurableExecutionArn;

    if (!durableExecutionArn) {
      throw new Error(
        "No execution ARN found on invocation response. Is the function specified a durable function?",
      );
    }

    const testExecutionState = new TestExecutionState();

    const executionPromise = testExecutionState.createExecutionPromise();

    const historyPoller = new HistoryPoller({
      pollInterval: this.config.pollInterval,
      durableExecutionArn: durableExecutionArn,

      testExecutionState,
      apiClient: {
        getHistory: (request) =>
          this.client.send(new GetDurableExecutionHistoryCommand(request)),
      },
      onOperationEventsReceived: (operationEvents: OperationEvents[]) => {
        this.waitManager.handleCheckpointReceived(
          operationEvents,
          this.operationStorage.getTrackedOperations(),
        );
        this.operationStorage.populateOperations(operationEvents);
      },
    });

    historyPoller.startPolling();

    try {
      const lambdaResponse = await executionPromise;

      return this.formatter.formatTestResult(
        lambdaResponse,
        historyPoller.getEvents(),
        this.operationStorage,
      );
    } finally {
      historyPoller.stopPolling();
      this.waitManager.clearWaitingOperations();
    }
  }

  /**
   * Gets an operation by name, defaulting to the first occurrence (index 0).
   *
   * This is a convenience method equivalent to calling `getOperationByNameAndIndex(name, 0)`.
   *
   * @typeParam TOperationResult - The expected result type of the operation
   * @param name - The name of the operation to retrieve
   * @returns An operation instance that can be used to inspect operation details
   *
   * @example
   * ```typescript
   * const stepOp = runner.getOperation<string>('processData');
   * await stepOp.waitForData();
   * const details = stepOp.getStepDetails();
   * ```
   */
  getOperation<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TOperationResult = any,
  >(name: string): DurableOperation<TOperationResult> {
    return this.getOperationByNameAndIndex(name, 0);
  }

  /**
   * Gets an operation by its execution order index.
   *
   * Operations are indexed in the order they were executed, starting from 0.
   * This method is useful when you know the execution order of operations.
   *
   * @typeParam TOperationResult - The expected result type of the operation
   * @param index - The zero-based index of the operation in execution order
   * @returns An operation instance for the operation at the specified index
   *
   * @example
   * ```typescript
   * // Get the first operation that was executed
   * const firstOp = runner.getOperationByIndex<number>(0);
   * await firstOp.waitForData();
   * ```
   */
  getOperationByIndex<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TOperationResult = any,
  >(index: number): DurableOperation<TOperationResult> {
    const operation = new CloudOperation<TOperationResult>(
      this.waitManager,
      this.indexedOperations,
      this.apiClient,
      this.config.invocationType,
      this.indexedOperations.getByIndex(index),
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
   * When a durable function executes the same named operation multiple times,
   * this method allows you to access a specific occurrence by its index.
   *
   * @typeParam TOperationResult - The expected result type of the operation
   * @param name - The name of the operation
   * @param index - The zero-based index among operations with the same name
   * @returns An operation instance for the specified named operation occurrence
   *
   * @example
   * ```typescript
   * // Get the second occurrence of an operation named 'validateInput'
   * const secondValidation = runner.getOperationByNameAndIndex<boolean>('validateInput', 1);
   * await secondValidation.waitForData();
   * const isValid = secondValidation.getStepDetails()?.result;
   * ```
   */
  getOperationByNameAndIndex<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TOperationResult = any,
  >(name: string, index: number): DurableOperation<TOperationResult> {
    const operation = new CloudOperation<TOperationResult>(
      this.waitManager,
      this.indexedOperations,
      this.apiClient,
      this.config.invocationType,
      this.indexedOperations.getByNameAndIndex(name, index),
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
   * Gets an operation by its unique identifier.
   *
   * Each operation in a durable execution has a unique ID. This method
   * allows you to retrieve an operation when you know its specific ID.
   *
   * @typeParam TOperationResult - The expected result type of the operation
   * @param id - The unique identifier of the operation
   * @returns An operation instance for the operation with the specified ID
   *
   * @example
   * ```typescript
   * const operation = runner.getOperationById<string>('op-abc123');
   * await operation.waitForData();
   * const result = operation.getContextDetails()?.result;
   * ```
   */
  getOperationById<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TOperationResult = any,
  >(id: string): DurableOperation<TOperationResult> {
    const operation = new CloudOperation<TOperationResult>(
      this.waitManager,
      this.indexedOperations,
      this.apiClient,
      this.config.invocationType,
      this.indexedOperations.getById(id),
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
   *
   * @beta
   */
  reset() {
    this.indexedOperations = new IndexedOperations([]);
    this.waitManager = new OperationWaitManager(this.indexedOperations);
    this.operationStorage = new OperationStorage(
      this.waitManager,
      this.indexedOperations,
      this.apiClient,
    );
  }
}
