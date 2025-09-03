import { OperationInterceptor } from "@amzn/durable-executions-language-sdk";
import { ExecutionId } from "../../../checkpoint-server/utils/tagged-strings";
import { OperationWaitManager } from "./operation-wait-manager";
import { OperationWithData } from "../../common/operations/operation-with-data";
import { IndexedOperations } from "../../common/indexed-operations";

export interface MockOperationParameters {
  name?: string;
  index?: number;
  id?: string;
}

interface RegisterMockParameters {
  callback: () => Promise<unknown>;
  count: number;
}

interface RegisterIndexMockParameters extends RegisterMockParameters {
  index: number;
}

interface RegisterNameMockParameters extends RegisterMockParameters {
  name: string;
  index?: number;
}

export class MockOperation<
  OperationResultValue = unknown
> extends OperationWithData<OperationResultValue> {
  public readonly _mockName?: string;
  public readonly _mockIndex?: number;
  public readonly _mockId?: string;
  private readonly nameMocks: RegisterNameMockParameters[] = [];
  private readonly indexMocks: RegisterIndexMockParameters[] = [];

  constructor(
    params: MockOperationParameters,
    waitManager: OperationWaitManager,
    operationIndex: IndexedOperations
  ) {
    super(waitManager, operationIndex);
    this._mockName = params.name;
    this._mockIndex = params.index;
    this._mockId = params.id;
  }

  registerMocks(executionId: ExecutionId) {
    for (const mockParameters of this.nameMocks) {
      OperationInterceptor.forExecution(executionId)
        .onName(mockParameters.name, mockParameters.index)
        .mock(mockParameters.callback, mockParameters.count);
    }
    for (const mockParameters of this.indexMocks) {
      OperationInterceptor.forExecution(executionId)
        .onIndex(mockParameters.index)
        .mock(mockParameters.callback, mockParameters.count);
    }
  }

  // Mock the implementation of the operation
  mockImplementation(fn: () => Promise<OperationResultValue>): this {
    if (this._mockName !== undefined) {
      this.nameMocks.push({
        name: this._mockName,
        index: this._mockIndex,
        callback: fn,
        count: Infinity,
      });
    } else if (this._mockIndex !== undefined) {
      this.indexMocks.push({
        index: this._mockIndex,
        callback: fn,
        count: Infinity,
      });
    } else if (this._mockId !== undefined) {
      throw new Error("Mocking for ids is not supported");
    } else {
      throw new Error(
        "Failed to mock implementation with missing name and index"
      );
    }

    return this;
  }

  mockImplementationOnce(fn: () => Promise<OperationResultValue>): this {
    if (this._mockName !== undefined) {
      this.nameMocks.push({
        name: this._mockName,
        index: this._mockIndex,
        callback: fn,
        count: 1,
      });
    } else if (this._mockIndex !== undefined) {
      this.indexMocks.push({
        index: this._mockIndex,
        callback: fn,
        count: 1,
      });
    } else if (this._mockId !== undefined) {
      throw new Error("Mocking for ids is not supported");
    } else {
      throw new Error(
        "Failed to mock implementation with missing name and index"
      );
    }

    return this;
  }

  // Helper function for mocking the return value of the operation
  mockResolvedValue(value: OperationResultValue): this {
    return this.mockImplementation(() => Promise.resolve(value));
  }

  // Helper function for mocking with an error
  mockRejectedValue(error: unknown): this {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    return this.mockImplementation(() => Promise.reject(error));
  }

  mockRejectedValueOnce(error: unknown): this {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    return this.mockImplementationOnce(() => Promise.reject(error));
  }

  // Enable/disable time skipping
  skipTime(): this {
    throw new Error("Not implemented");
  }

  getMockCount(): number {
    return this.nameMocks.length + this.indexMocks.length;
  }

  hasMocks(): boolean {
    return this.nameMocks.length > 0 || this.indexMocks.length > 0;
  }

  getNameMockCount(): number {
    return this.nameMocks.length;
  }

  getIndexMockCount(): number {
    return this.indexMocks.length;
  }
}
