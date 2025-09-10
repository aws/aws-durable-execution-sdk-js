import { ExecutionMockHandler } from "./execution-mock-handler";

/**
 * Registry that manages mock handlers for different execution contexts
 */
export class MockRegistry {
  private static instance: MockRegistry;
  private readonly handlers = new Map<string, ExecutionMockHandler>();

  static getInstance(): MockRegistry {
    if (!MockRegistry.instance) {
      MockRegistry.instance = new MockRegistry();
    }
    return MockRegistry.instance;
  }

  getHandler(executionId: string): ExecutionMockHandler {
    if (!this.handlers.has(executionId)) {
      this.handlers.set(executionId, new ExecutionMockHandler());
    }
    return this.handlers.get(executionId)!;
  }

  /**
   * Clear all handlers (useful for testing)
   */
  clearAll(): void {
    this.handlers.clear();
  }
}
