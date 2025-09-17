import {
  Invoke20150331Command,
  LambdaClientConfig,
  LambdaClient,
  GetDurableExecutionCommand,
  GetDurableExecutionHistoryCommand,
  GetDurableExecutionHistoryResponse,
} from "@amzn/dex-internal-sdk";
import { IndexedOperations } from "../common/indexed-operations";
import { OperationStorage } from "../common/operation-storage";
import { OperationWithData } from "../common/operations/operation-with-data";
import {
  DurableTestRunner,
  InvokeRequest,
  TestResult,
} from "../durable-test-runner";
import { OperationWaitManager } from "../local/operations/operation-wait-manager";
import { ResultFormatter } from "../local/result-formatter";
import { historyEventsToOperationEvents } from "./utils/process-history-events/process-history-events";

export interface CloudDurableTestRunnerParameters {
  functionName: string;
  config?: LambdaClientConfig;
}

export class CloudDurableTestRunner<ResultType>
  implements DurableTestRunner<OperationWithData, ResultType>
{
  private readonly functionArn: string;
  private readonly client: LambdaClient;
  private readonly formatter = new ResultFormatter<ResultType>();
  private readonly waitManager = new OperationWaitManager();
  private readonly indexedOperations = new IndexedOperations([]);
  private readonly operationStorage = new OperationStorage(
    this.waitManager,
    this.indexedOperations
  );
  private history: GetDurableExecutionHistoryResponse | undefined = undefined;

  constructor({ functionName: functionArn, config }: CloudDurableTestRunnerParameters) {
    this.client = new LambdaClient(config ?? {});
    this.functionArn = functionArn;
  }

  async run(params?: InvokeRequest): Promise<TestResult<ResultType>> {
    const invokeResult = await this.client.send(
      new Invoke20150331Command({
        FunctionName: this.functionArn,
        Payload: params?.payload ? JSON.stringify(params.payload) : undefined,
      })
    );

    const executionArn = invokeResult.DurableExecutionArn;

    const result = await this.client.send(
      new GetDurableExecutionCommand({
        DurableExecutionArn: executionArn,
      })
    );

    // TODO: poll for history instead of waiting for invoke to complete
    const history = await this.client.send(
      new GetDurableExecutionHistoryCommand({
        DurableExecutionArn: executionArn,
        IncludeExecutionData: true,
      })
    );

    this.history = history;

    const operationEvents = historyEventsToOperationEvents(
      this.history.Events ?? []
    );
    this.operationStorage.populateOperations(operationEvents);

    const lambdaResponse = {
      status: result.Status,
      result: result.Result,
      error: result.Error,
    };

    return this.formatter.formatTestResult(
      lambdaResponse,
      this.operationStorage,
      []
    );
  }

  getHistory() {
    return this.history;
  }
  getOperation<T>(name: string): OperationWithData<T> {
    return this.getOperationByNameAndIndex(name, 0);
  }
  getOperationByIndex<T>(index: number): OperationWithData<T> {
    return new OperationWithData(
      this.waitManager,
      this.indexedOperations,
      this.indexedOperations.getByIndex(index)
    );
  }
  getOperationByNameAndIndex<T>(
    name: string,
    index: number
  ): OperationWithData<T> {
    return new OperationWithData(
      this.waitManager,
      this.indexedOperations,
      this.indexedOperations.getByNameAndIndex(name, index)
    );
  }
  getOperationById<T>(id: string): OperationWithData<T> {
    return new OperationWithData(
      this.waitManager,
      this.indexedOperations,
      this.indexedOperations.getById(id)
    );
  }
}
