interface MockCallbackWithCount {
  callback: MockCallback;
  count: number;
}

export class MockCallbackQueue {
  private readonly queue: MockCallbackWithCount[];
  private hasTemporaryMocks = false;

  constructor(initialValue: MockCallbackWithCount[] = []) {
    this.queue = initialValue;
  }

  enqueueCallbacks(callbacks: MockCallbackWithCount): void {
    if (callbacks.count === Infinity) {
      if (!this.hasTemporaryMocks) {
        this.queue.length = 0;
      }
    } else {
      this.hasTemporaryMocks = true;
    }

    this.queue.push(callbacks);
  }

  dequeueCallback(): MockCallback | undefined {
    const firstCallback = this.queue.at(0);
    if (!firstCallback) {
      return undefined;
    }

    firstCallback.count--;
    if (firstCallback.count <= 0) {
      return this.queue.shift()?.callback;
    }

    return firstCallback.callback;
  }
}
export type MockCallback = () => Promise<unknown>;
