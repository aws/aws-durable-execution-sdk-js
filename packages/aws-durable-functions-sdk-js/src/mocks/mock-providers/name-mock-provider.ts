import { MockCallback, MockCallbackQueue } from "../mock-callback-queue";

/**
 * Handles name-based mock registration and retrieval
 */
export class NameMockProvider {
  private readonly mocks = new Map<string, MockCallbackQueue>();

  register(name: string, callback: MockCallback, count: number): void {
    const queue = this.mocks.get(name) ?? new MockCallbackQueue();
    queue.enqueueCallbacks({ callback, count });
    this.mocks.set(name, queue);
  }

  getMock(name: string): MockCallback | undefined {
    return this.mocks.get(name)?.dequeueCallback();
  }
}
