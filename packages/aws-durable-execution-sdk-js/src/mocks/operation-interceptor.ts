import { MockCallback } from "./mock-callback-queue";
import { ExecutionMockHandler } from "./execution-mock-handler";
import { MockRegistry } from "./mock-registry";

/**
 * Builder class for configuring mocks
 */
class MockBuilder {
  constructor(
    private readonly handler: ExecutionMockHandler,
    private readonly strategy: "index" | "name",
    private readonly indexValue?: number,
    private readonly nameValue?: string,
    private readonly nameIndexValue?: number,
  ) {}

  /**
   * Register a mock implementation
   */
  mock(callback: MockCallback, count: number = Infinity): void {
    if (this.strategy === "index" && this.indexValue !== undefined) {
      this.handler.registerIndexMock(this.indexValue, callback, count);
    } else if (this.strategy === "name" && this.nameValue !== undefined) {
      this.handler.registerNameMock(
        this.nameValue,
        callback,
        count,
        this.nameIndexValue,
      );
    }
  }
}

/**
 * Execution-specific mock runner
 */
class MockableExecutionRunner {
  constructor(private readonly handler: ExecutionMockHandler) {}

  /**
   * Configure a mock for a specific operation index
   */
  onIndex(index: number): MockBuilder {
    return new MockBuilder(this.handler, "index", index);
  }

  /**
   * Configure a mock for a specific operation name
   */
  onName(name: string, index?: number): MockBuilder {
    return new MockBuilder(this.handler, "name", undefined, name, index);
  }

  /**
   * Execute an operation with mocking support
   */
  async execute<T>(
    operationName: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const mockCallback = this.handler.getMockCallback(operationName);
    return mockCallback ? (mockCallback() as T) : fn();
  }

  /**
   * Record an operation occurrence and check if it would be mocked
   */
  recordOnly(operationName: string | undefined): boolean {
    const mockCallback = this.handler.recordOperation(operationName);
    return !!mockCallback;
  }
}

/**
 * Main OperationInterceptor API - provides fluent interface for all mock operations
 */
export class OperationInterceptor {
  /**
   * Get a mockable execution runner for a specific execution
   */
  static forExecution(executionId: string): MockableExecutionRunner {
    const handler = MockRegistry.getInstance().getHandler(executionId);
    return new MockableExecutionRunner(handler);
  }

  /**
   * Clear all mock handlers
   */
  static clearAll(): void {
    MockRegistry.getInstance().clearAll();
  }
}
