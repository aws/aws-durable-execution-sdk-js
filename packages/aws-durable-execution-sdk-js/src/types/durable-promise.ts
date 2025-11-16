/**
 * Union type that supports both Promise and PromiseLike for forward compatibility
 * Allows switching between traditional Promise implementations and custom PromiseLike implementations
 */
export type DurablePromise<T> = Promise<T> | PromiseLike<T>;
