# Migration Guide: Converting Handlers to DurablePromise

## Overview

All handlers need to be converted from returning `Promise<T>` to `DurablePromise<T>` to enable lazy evaluation and prevent early termination issues.

## Handlers to Update

### 1. ✅ wait-handler (DONE)

- **File**: `src/handlers/wait-handler/wait-handler.ts`
- **Change**: Return `DurablePromise<void>` instead of `Promise<void>`
- **Pattern**: Wrap async logic in `new DurablePromise(async () => { ... })`

### 2. step-handler

- **File**: `src/handlers/step-handler/step-handler.ts`
- **Return type**: `Promise<T>` → `DurablePromise<T>`
- **Impact**: Core operation, affects all step calls

### 3. invoke-handler

- **File**: `src/handlers/invoke-handler/invoke-handler.ts`
- **Return type**: `Promise<O>` → `DurablePromise<O>`
- **Impact**: Critical - invoke can terminate Lambda

### 4. parallel-handler

- **File**: `src/handlers/parallel-handler/parallel-handler.ts`
- **Return type**: `Promise<BatchResult<T>>` → `DurablePromise<BatchResult<T>>`

### 5. map-handler

- **File**: `src/handlers/map-handler/map-handler.ts`
- **Return type**: `Promise<BatchResult<TOutput>>` → `DurablePromise<BatchResult<TOutput>>`

### 6. callback-handler

- **File**: `src/handlers/callback-handler/callback.ts`
- **Return type**: `Promise<CreateCallbackResult<T>>` → `DurablePromise<CreateCallbackResult<T>>`
- **Note**: Already has `TerminatingPromise` - may need integration

### 7. wait-for-callback-handler

- **File**: `src/handlers/wait-for-callback-handler/wait-for-callback-handler.ts`
- **Return type**: `Promise<T>` → `DurablePromise<T>`

### 8. wait-for-condition-handler

- **File**: `src/handlers/wait-for-condition-handler/wait-for-condition-handler.ts`
- **Return type**: `Promise<T>` → `DurablePromise<T>`

### 9. run-in-child-context-handler

- **File**: `src/handlers/run-in-child-context-handler/run-in-child-context-handler.ts`
- **Return type**: `Promise<T>` → `DurablePromise<T>`

### 10. promise-handler

- **File**: `src/handlers/promise-handler/promise-handler.ts`
- **Return type**: Various promise methods
- **Note**: May need special handling for Promise.all/race/allSettled

### 11. concurrent-execution-handler

- **File**: `src/handlers/concurrent-execution-handler/concurrent-execution-handler.ts`
- **Return type**: `Promise<BatchResult<R>>` → `DurablePromise<BatchResult<R>>`

## Conversion Pattern

### Before (Eager Execution)

```typescript
export const createHandler = (...) => {
  async function handler(...): Promise<T> {
    // Logic executes immediately
    const result = await doWork();
    return result;
  }
  return handler;
};
```

### After (Lazy Execution)

```typescript
import { DurablePromise } from "../../utils/durable-promise/durable-promise";

export const createHandler = (...) => {
  function handler(...): DurablePromise<T> {
    return new DurablePromise(async () => {
      // Logic only executes when awaited
      const result = await doWork();
      return result;
    });
  }
  return handler;
};
```

## Type Updates

### DurableContext Interface

Update `src/types/durable-context.ts`:

```typescript
export interface DurableContext {
  // Before
  step<T>(name: string, fn: StepFunc<T>, config?: StepConfig<T>): Promise<T>;
  wait(duration: Duration): Promise<void>;
  invoke<I, O>(
    funcId: string,
    input: I,
    config?: InvokeConfig<I, O>,
  ): Promise<O>;

  // After
  step<T>(
    name: string,
    fn: StepFunc<T>,
    config?: StepConfig<T>,
  ): DurablePromise<T>;
  wait(duration: Duration): DurablePromise<void>;
  invoke<I, O>(
    funcId: string,
    input: I,
    config?: InvokeConfig<I, O>,
  ): DurablePromise<O>;
  // ... etc for all methods
}
```

## Testing Updates

All handler tests need to be updated to handle lazy evaluation:

```typescript
// Before
const result = handler(...);
expect(mockCheckpoint).toHaveBeenCalled(); // Fails with lazy evaluation

// After
const promise = handler(...);
expect(mockCheckpoint).not.toHaveBeenCalled(); // Not called yet
await promise;
expect(mockCheckpoint).toHaveBeenCalled(); // Now called
```

## Export Updates

Update `src/index.ts` to export `DurablePromise`:

```typescript
export { DurablePromise } from "./utils/durable-promise/durable-promise";
```

## Breaking Changes

This is a **non-breaking change** for users because:

- `DurablePromise` implements `PromiseLike<T>`
- Works with `await`, `Promise.all()`, `Promise.race()`, etc.
- Existing code continues to work
- Only behavior change: execution is deferred until awaited

## Benefits

1. **Prevents early termination**: Operations don't execute until composed
2. **Enables composition**: Create operations and combine them later
3. **Better performance**: Only execute operations that are actually awaited
4. **More intuitive**: Matches user expectations for promise behavior
