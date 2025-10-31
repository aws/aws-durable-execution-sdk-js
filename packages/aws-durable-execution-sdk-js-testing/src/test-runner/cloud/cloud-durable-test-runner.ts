import {
  InvokeCommand,
  LambdaClientConfig,
  LambdaClient,
  GetDurableExecutionCommand,
  GetDurableExecutionHistoryCommand,
  InvocationType,
} from "@aws-sdk/client-lambda";
import { IndexedOperations } from "../common/indexed-operations";
import { OperationStorage } from "../common/operation-storage";
import {
  OperationEvents,
  OperationWithData,
} from "../common/operations/operation-with-data";
import {
  DurableTestRunner,
  InvokeRequest,
  TestResult,
} from "../durable-test-runner";
import { OperationWaitManager } from "../local/operations/operation-wait-manager";
import { ResultFormatter } from "../local/result-formatter";
import { HistoryPoller } from "./history-poller";
import { TestExecutionState } from "../common/test-execution-state";
import {
  createDurableApiClient,
  DurableApiClient,
} from "../common/create-durable-api-client";
import { CloudOperation } from "./operations/cloud-operation";

export { InvocationType };

interface CloudDurableTestRunnerConfigInternal {
  pollInterval: number;
  invocationType: InvocationType;
}

export type CloudDurableTestRunnerConfig =
  Partial<CloudDurableTestRunnerConfigInternal>;

export interface CloudDurableTestRunnerParameters {
  functionName: string;
  clientConfig?: LambdaClientConfig;
  config?: CloudDurableTestRunnerConfig;
}

export class CloudDurableTestRunner<ResultType>
  implements DurableTestRunner<OperationWithData, ResultType>
{
  private readonly functionArn: string;
  private readonly client: LambdaClient;
  private readonly formatter = new ResultFormatter<ResultType>();
  private indexedOperations = new IndexedOperations([]);
  private waitManager = new OperationWaitManager(this.indexedOperations);
  private operationStorage: OperationStorage;
  private readonly apiClient: DurableApiClient;
  private readonly config: CloudDurableTestRunnerConfigInternal;

  constructor({
    functionName: functionArn,
    clientConfig,
    config,
  }: CloudDurableTestRunnerParameters) {
    this.client = new LambdaClient(clientConfig ?? {});
    this.apiClient = createDurableApiClient(() => this.client);
    this.functionArn = functionArn;
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

  async run(params?: InvokeRequest): Promise<TestResult<ResultType>> {
    const asyncInvokeResult = await this.client.send(
      new InvokeCommand({
        FunctionName: this.functionArn,
        Payload: params?.payload ? JSON.stringify(params.payload) : undefined,
        InvocationType: this.config.invocationType,
      }),
    );

    const durableExecutionArn = asyncInvokeResult.DurableExecutionArn;

    if (!durableExecutionArn) {
      throw new Error("No execution ARN found on invocation response");
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
        getExecution: (request) =>
          this.client.send(new GetDurableExecutionCommand(request)),
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
    }
  }

  getOperation<T>(name: string): CloudOperation<T> {
    return this.getOperationByNameAndIndex(name, 0);
  }

  getOperationByIndex<T>(index: number): CloudOperation<T> {
    const operation = new CloudOperation<T>(
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

  getOperationByNameAndIndex<T>(
    name: string,
    index: number,
  ): CloudOperation<T> {
    const operation = new CloudOperation<T>(
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

  getOperationById<T>(id: string): CloudOperation<T> {
    const operation = new CloudOperation<T>(
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
