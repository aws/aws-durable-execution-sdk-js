/**
 * A lazy thenable that defers execution until .then() or await is called.
 * This prevents eager execution of operations that might terminate the Lambda.
 */
export class DurablePromise<T> implements PromiseLike<T> {
  private promise: Promise<T> | null = null;

  constructor(private readonly fn: () => Promise<T>) {}

  private ensurePromise(): Promise<T> {
    if (!this.promise) {
      this.promise = this.fn();
    }
    return this.promise;
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.ensurePromise().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult> {
    return this.ensurePromise().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.ensurePromise().finally(onfinally);
  }
}
