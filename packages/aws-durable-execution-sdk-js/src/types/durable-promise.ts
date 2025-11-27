/**
 * A promise that defers execution until it's awaited or .then/.catch/.finally is called
 *
 * @public
 */
export class DurablePromise<T> implements Promise<T> {
  /**
   * The actual promise instance, created only when execution begins.
   * Starts as null and remains null until the DurablePromise is first awaited
   * or chained (.then/.catch/.finally). Once created, it holds the running
   * promise returned by the _executor function.
   *
   * Example lifecycle:
   * ```typescript
   * const dp = new DurablePromise(() => fetch('/api')); // _promise = null
   * console.log(dp.isExecuted); // false
   *
   * const result = await dp; // NOW _promise = fetch('/api') promise
   * console.log(dp.isExecuted); // true
   * ```
   *
   * This lazy initialization prevents the executor from running until needed.
   */
  private _promise: Promise<T> | null = null;

  /**
   * Function that contains the deferred execution logic.
   * This function is NOT called when the DurablePromise is created - it's only
   * executed when the promise is first awaited or chained (.then/.catch/.finally).
   *
   * Example:
   * ```typescript
   * const durablePromise = new DurablePromise(async () => {
   *   console.log("This runs ONLY when awaited, not when created");
   *   return await someAsyncOperation();
   * });
   *
   * // At this point, nothing has executed yet
   * console.log("Promise created but not executed");
   *
   * // NOW the executor function runs
   * const result = await durablePromise;
   * ```
   */
  private _executor: () => Promise<T>;

  /** Flag indicating whether the promise has been executed (awaited or chained) */
  private _isExecuted = false;

  /**
   * Creates a new DurablePromise
   * @param executor - Function containing the deferred execution logic
   */
  constructor(executor: () => Promise<T>) {
    this._executor = executor;
  }

  /**
   * Ensures the promise is executed, creating the actual promise if needed
   * @returns The underlying promise instance
   */
  private ensureExecution(): Promise<T> {
    if (!this._promise) {
      this._isExecuted = true;

      // Execute the promise
      this._promise = this._executor();
    }
    return this._promise;
  }

  /**
   * Attaches callbacks for the resolution and/or rejection of the Promise
   * Triggers execution if not already started
   */
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

  /**
   * Attaches a callback for only the rejection of the Promise
   * Triggers execution if not already started
   */
  catch<TResult = never>(
    onrejected?:
      | ((reason: unknown) => TResult | PromiseLike<TResult>)
      | undefined
      | null,
  ): Promise<T | TResult> {
    return this.ensureExecution().catch(onrejected);
  }

  /**
   * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected)
   * Triggers execution if not already started
   */
  finally(onfinally?: (() => void) | undefined | null): Promise<T> {
    return this.ensureExecution().finally(onfinally);
  }

  /** Returns the string tag for the promise type */
  get [Symbol.toStringTag](): string {
    return "DurablePromise";
  }

  /**
   * Check if the promise has been executed (awaited or had .then/.catch/.finally called)
   * @returns true if execution has started, false otherwise
   */
  get isExecuted(): boolean {
    return this._isExecuted;
  }
}
