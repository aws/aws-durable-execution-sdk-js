/**
 * A lazy thenable that defers execution until .then() or await is called.
 * This prevents eager execution of operations that might terminate the Lambda.
 */
export class DurablePromise<T> implements Promise<T> {
  private promise: Promise<T> | null = null;

  constructor(private readonly fn?: () => Promise<T>) {}

  get [Symbol.toStringTag](): string {
    return "DurablePromise";
  }

  private ensurePromise(): Promise<T> {
    if (!this.fn) {
      this.promise = new Promise<never>(() => {});
      return this.promise;
    }

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
    return this.then(undefined, onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.then(
      (value) => {
        onfinally?.();
        return value;
      },
      (reason) => {
        onfinally?.();
        throw reason;
      },
    );
  }
}
