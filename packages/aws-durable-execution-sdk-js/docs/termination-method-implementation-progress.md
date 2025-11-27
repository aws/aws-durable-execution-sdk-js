# Termination Method Propagation - Implementation Progress

## Completed ✅

### Core Infrastructure

- [x] Add `terminationMethod` and `childPromises` to `DurableContext` interface
- [x] Add `terminationMethod` and `childPromises` to `DurableContextImpl` class
- [x] Remove default from `DurablePromise._terminationMethod`
- [x] Add `_childContext` field to `DurablePromise`
- [x] Add `setChildContext()` method to `DurablePromise`
- [x] Update `attachTerminationMethod()` to propagate to children recursively
- [x] Update `getTerminationMethod()` to check promise override then context default
- [x] Initialize root context with default `terminate` function in `with-durable-execution.ts`

### Handler Updates

- [x] **step handler**: Add durableContext parameter, register/cleanup in childPromises

## Remaining Work 🚧

### Handler Registration (Operations WITHOUT Child Context)

These handlers need to:

1. Add `durableContext` parameter to `createXHandler` function
2. Register promise in `durableContext.childPromises.add(promise)`
3. Cleanup in `promise.finally(() => durableContext.childPromises.delete(promise))`
4. Update call site in `durable-context.ts` to pass `this` as durableContext

Handlers to update:

- [ ] **wait handler** (`createWaitHandler`)
- [ ] **invoke handler** (`createInvokeHandler`)
- [ ] **callback handler** (`createCallback` in callback.ts)
- [ ] **waitForCondition handler** (`createWaitForConditionHandler`)

### Handler Child Context Setup (Operations WITH Child Context)

These handlers need to:

1. Add `durableContext` parameter to `createXHandler` function
2. Register promise in parent's `durableContext.childPromises`
3. Cleanup in `promise.finally()`
4. Call `promise.setChildContext(childContext)` when child context is created inside executor
5. Update call site to pass `this` as durableContext

Handlers to update:

- [ ] **runInChildContext handler** (`createRunInChildContextHandler`)
- [ ] **waitForCallback handler** (`createWaitForCallbackHandler`)
- [ ] **parallel handler** (`createParallelHandler`)
- [ ] **map handler** (`createMapHandler`)
- [ ] **concurrentExecution handler** (`createConcurrentExecutionHandler`)

### Testing

- [ ] Fix existing test compilation errors (unrelated to this feature)
- [ ] Verify termination method tests pass
- [ ] Add integration test for parent-to-child propagation
- [ ] Test nested contexts (grandchildren)

## Implementation Pattern

### For Operations WITHOUT Child Context (e.g., step, wait, invoke)

```typescript
// In handler file
export const createXHandler = (
  // ... existing parameters
  durableContext: any, // Add this
  // ... remaining parameters
) => {
  return (...args) => {
    const durablePromise = new DurablePromise(async () => {
      // handler logic
    });

    // Register and cleanup
    durableContext.childPromises.add(durablePromise);
    durablePromise.finally(() => {
      durableContext.childPromises.delete(durablePromise);
    });

    return durablePromise;
  };
};

// In durable-context.ts
const handler = createXHandler(
  // ... existing args
  this, // Pass DurableContext
  // ... remaining args
);
```

### For Operations WITH Child Context (e.g., runInChildContext, waitForCallback)

```typescript
// In handler file
export const createXHandler = (
  // ... existing parameters
  durableContext: any, // Add this (parent context)
  // ... remaining parameters
) => {
  return (...args) => {
    const durablePromise = new DurablePromise(async () => {
      // Create child context
      const childContext = createDurableContext({
        terminationMethod: durableContext.terminationMethod, // Inherit
        childPromises: new Set(),
        // ... other fields
      });

      // Link child context to promise
      durablePromise.setChildContext(childContext);

      // Execute user function with child context
      return await userFunction(childContext);
    });

    // Register in PARENT context and cleanup
    durableContext.childPromises.add(durablePromise);
    durablePromise.finally(() => {
      durableContext.childPromises.delete(durablePromise);
    });

    return durablePromise;
  };
};
```

## Notes

- All handlers are called from within `DurableContextImpl` methods, so `this` is available
- Use `any` type for `durableContext` parameter to avoid circular dependencies
- The pattern is consistent across all handlers - just add parameter, register, cleanup
- Child context handlers additionally call `setChildContext()` inside the executor

## Next Steps

1. Update remaining handlers following the patterns above
2. Run tests to verify implementation
3. Fix any compilation errors
4. Add integration tests for propagation behavior
