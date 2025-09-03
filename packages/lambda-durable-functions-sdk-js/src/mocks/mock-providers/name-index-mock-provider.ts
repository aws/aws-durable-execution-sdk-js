import { MockCallback, MockCallbackQueue } from "../mock-callback-queue";

/**
 * Handles name+index-based mock registration and retrieval
 */
export class NameIndexMockProvider {
  private readonly mocks = new Map<string, Map<number, MockCallbackQueue>>();

  register(
    name: string,
    index: number,
    callback: MockCallback,
    count: number,
  ): void {
    const nameMap =
      this.mocks.get(name) ?? new Map<number, MockCallbackQueue>();
    const queue = nameMap.get(index) ?? new MockCallbackQueue();

    queue.enqueueCallbacks({ callback, count });
    nameMap.set(index, queue);
    this.mocks.set(name, nameMap);
  }

  getMock(name: string, index: number): MockCallback | undefined {
    return this.mocks.get(name)?.get(index)?.dequeueCallback();
  }
}
