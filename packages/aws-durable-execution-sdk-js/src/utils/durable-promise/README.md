# DurablePromise - Lazy Thenable for Durable Execution

## Problem

When handlers return regular `Promise<T>`, they execute **eagerly** as soon as they're called:

```typescript
// ❌ PROBLEM: Both operations start immediately
const wait1 = context.wait(10); // Starts executing NOW
const wait2 = context.wait(5); // Starts executing NOW

// If wait1 terminates the Lambda, we never reach this line
const result = await Promise.race([wait1, wait2]);
```

This creates issues:

1. **Early termination**: Operations that terminate Lambda (like `invoke`) prevent reaching `await` or `Promise.race`
2. **No composition**: Can't create operations and compose them later
3. **Eager execution**: Operations run even if never awaited

## Solution: DurablePromise

`DurablePromise` is a **lazy thenable** that defers execution until `.then()` or `await`:

```typescript
// ✅ SOLUTION: Operations don't start until awaited
const wait1 = context.wait(10); // Returns DurablePromise, doesn't execute
const wait2 = context.wait(5); // Returns DurablePromise, doesn't execute

// Both start executing when Promise.race calls .then()
const result = await Promise.race([wait1, wait2]);
```

## Benefits

### 1. Safe Composition

```typescript
// Create operations without executing them
const operations = [
  context.step("op1", async () => doWork1()),
  context.step("op2", async () => doWork2()),
  context.invoke("func", input),
];

// Compose them later
const results = await Promise.all(operations);
```

### 2. Conditional Execution

```typescript
const slowOp = context.wait({ seconds: 60 });
const fastOp = context.wait({ seconds: 1 });

// Only execute if condition is met
if (needsTimeout) {
  await Promise.race([slowOp, fastOp]);
}
// If condition is false, operations never execute
```

### 3. Prevents Early Termination

```typescript
// Create invoke operation (which could terminate Lambda)
const invokeOp = context.invoke("other-function", data);

// Create other operations
const waitOp = context.wait({ seconds: 5 });

// Both start together - no early termination
await Promise.race([invokeOp, waitOp]);
```

## Implementation

`DurablePromise` implements `PromiseLike<T>` interface:

```typescript
class DurablePromise<T> implements PromiseLike<T> {
  private promise: Promise<T> | null = null;

  constructor(private readonly executor: () => Promise<T>) {}

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    // Lazy execution: only run executor when .then() is called
    if (!this.promise) {
      this.promise = this.executor();
    }
    return this.promise.then(onfulfilled, onrejected);
  }
}
```

## Usage in Handlers

All handlers should return `DurablePromise` instead of `Promise`:

```typescript
// Before (eager)
export const createWaitHandler = (...) => {
  async function waitHandler(...): Promise<void> {
    // Executes immediately
  }
  return waitHandler;
};

// After (lazy)
export const createWaitHandler = (...) => {
  function waitHandler(...): DurablePromise<void> {
    return new DurablePromise(async () => {
      // Only executes when awaited
    });
  }
  return waitHandler;
};
```

## Compatibility

`DurablePromise` is fully compatible with:

- `await` keyword
- `Promise.all()`
- `Promise.race()`
- `Promise.allSettled()`
- `.then()`, `.catch()`, `.finally()`
- Any code expecting `PromiseLike<T>`
