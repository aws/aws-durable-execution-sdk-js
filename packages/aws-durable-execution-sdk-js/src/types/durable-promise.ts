/**
 * A promise that defers execution until it's awaited or .then/.catch/.finally is called
 */
export class DurablePromise<T> implements Promise<T> {
  private _promise: Promise<T> | null = null;
  private _executor: () => Promise<T>;
  private _isExecuted = false;

  constructor(executor: () => Promise<T>) {
    this._executor = executor;
  }

  private ensureExecution(): Promise<T> {
    if (!this._promise) {
      this._isExecuted = true;
      this._promise = this._executor();
    }
    return this._promise;
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
  ): Promise<TResult1 | TResult2> {
    return this.ensureExecution().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?:
      | ((reason: unknown) => TResult | PromiseLike<TResult>)
      | undefined
      | null,
  ): Promise<T | TResult> {
    return this.ensureExecution().catch(onrejected);
  }

  finally(onfinally?: (() => void) | undefined | null): Promise<T> {
    return this.ensureExecution().finally(onfinally);
  }

  get [Symbol.toStringTag](): string {
    return "DurablePromise";
  }

  /**
   * Check if the promise has been executed (awaited or had .then/.catch/.finally called)
   */
  get isExecuted(): boolean {
    return this._isExecuted;
  }
}
