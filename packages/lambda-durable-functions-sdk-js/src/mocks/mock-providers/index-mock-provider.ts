import { MockCallback, MockCallbackQueue } from "../mock-callback-queue";

/**
 * Handles index-based mock registration and retrieval
 */
export class IndexMockProvider {
  private readonly mocks = new Map<number, MockCallbackQueue>();

  register(index: number, callback: MockCallback, count: number): void {
    const queue = this.mocks.get(index) ?? new MockCallbackQueue();
    queue.enqueueCallbacks({ callback, count });
    this.mocks.set(index, queue);
  }

  getMock(index: number): MockCallback | undefined {
    return this.mocks.get(index)?.dequeueCallback();
  }
}
