import { MockCallback } from "./mock-callback-queue";
import { OperationTracker } from "./operation-tracker";
import { IndexMockProvider } from "./mock-providers/index-mock-provider";
import { NameMockProvider } from "./mock-providers/name-mock-provider";
import { NameIndexMockProvider } from "./mock-providers/name-index-mock-provider";

/**
 * Handles mock operations for a single execution context
 */
export class ExecutionMockHandler {
  private readonly operationTracker = new OperationTracker();
  private readonly indexMocks = new IndexMockProvider();
  private readonly nameMocks = new NameMockProvider();
  private readonly nameIndexMocks = new NameIndexMockProvider();

  registerIndexMock(
    index: number,
    callback: MockCallback,
    count: number,
  ): void {
    this.indexMocks.register(index, callback, count);
  }

  registerNameMock(
    name: string,
    callback: MockCallback,
    count: number,
    index?: number,
  ): void {
    if (index !== undefined) {
      this.nameIndexMocks.register(name, index, callback, count);
    } else {
      this.nameMocks.register(name, callback, count);
    }
  }

  /**
   * Records an operation and returns a mock callback if one is registered
   * Priority order: Index-based > Name-based > Name+Index-based
   */
  recordOperation(name?: string): MockCallback | undefined {
    const globalIndex = this.operationTracker.incrementGlobal();
    const nameIndex = name
      ? this.operationTracker.incrementNamed(name)
      : undefined;

    // Check index-based mocks first (highest priority)
    const indexMock = this.indexMocks.getMock(globalIndex);
    if (indexMock) {
      return indexMock;
    }

    // Check name-based mocks
    if (name) {
      const nameMock = this.nameMocks.getMock(name);
      if (nameMock) {
        return nameMock;
      }

      // Check name+index-based mocks (lowest priority)
      if (nameIndex !== undefined) {
        const nameIndexMock = this.nameIndexMocks.getMock(name, nameIndex);
        if (nameIndexMock) {
          return nameIndexMock;
        }
      }
    }

    return undefined;
  }

  /**
   * Gets a mock callback without executing/registering the operation
   */
  getMockCallback(name?: string): MockCallback | undefined {
    return this.recordOperation(name);
  }
}
