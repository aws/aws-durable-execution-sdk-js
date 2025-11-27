# Termination Method Propagation Design

## Problem Statement

When a user attaches a custom termination method to a parent operation (e.g., `waitForCallback`), child operations created within that context (e.g., `step`, `createCallback`) should automatically use the same termination method.

### Example Scenario

```typescript
const promise1 = context.waitForCallback(async (submit) => {
  // These run in a child context
  const promise2 = childContext.step(async () => "result");
  const promise3 = childContext.createCallback();
  return await promise2;
});

// Should propagate to promise2 and promise3
promise1.attachTerminationMethod(myTermination);
```

## Solution Design

### 1. DurableContext Structure

```typescript
interface DurableContext {
  terminationMethod: TerminationFunction; // Required, not optional
  childPromises: Set<DurablePromise<any>>; // Track all operations in this context
  // ... other existing fields
}
```

**Key Points:**

- Every `DurableContext` has a `terminationMethod` (no default in promises)
- `childPromises` tracks all operations created within this context
- Root context gets the default `terminate` function
- Child contexts inherit `terminationMethod` from parent

### 2. DurablePromise Changes

```typescript
class DurablePromise<T> {
  private _terminationMethod?: TerminationFunction; // No default
  private _childContext?: DurableContext; // Reference to child context (if any)

  constructor(executor: () => Promise<T>) {
    this._executor = executor;
  }

  /**
   * Set child context for operations that create nested contexts
   * @internal
   */
  setChildContext(childContext: DurableContext): void {
    this._childContext = childContext;
  }

  /**
   * Attach custom termination method and propagate to children
   * @internal
   */
  attachTerminationMethod(terminationMethod: TerminationFunction): void {
    this._terminationMethod = terminationMethod;

    // If this promise has a child context, propagate to its children
    if (this._childContext) {
      this._childContext.terminationMethod = terminationMethod;

      for (const childPromise of this._childContext.childPromises) {
        childPromise.attachTerminationMethod(terminationMethod);
      }
    }
  }

  /**
   * Get termination method for this promise
   * @internal
   */
  getTerminationMethod(): TerminationFunction {
    // Priority: promise override, then child context default
    return this._terminationMethod || this._childContext?.terminationMethod;
  }
}
```

### 3. Root Context Initialization

```typescript
// When creating the root DurableContext
const rootContext = createDurableContext({
  terminationMethod: terminate, // Default terminate function
  childPromises: new Set(),
  // ... other fields
});
```

### 4. Child Context Creation

```typescript
// In handlers that create child contexts (runInChildContext, waitForCallback, etc.)
const childContext = createDurableContext({
  terminationMethod: parentContext.terminationMethod, // Inherit from parent
  childPromises: new Set(), // New set for this context's children
  // ... other fields
});
```

### 5. Handler Implementation Patterns

#### Operations WITHOUT Child Context (step, wait, invoke, createCallback)

```typescript
// Example: step handler
const durablePromise = new DurablePromise(async () => {
  // Execute user function
  return await userFunction();
});

// Register in current context
durableContext.childPromises.add(durablePromise);

// Clean up when complete
durablePromise.finally(() => {
  durableContext.childPromises.delete(durablePromise);
});

return durablePromise;
```

#### Operations WITH Child Context (runInChildContext, waitForCallback, parallel, map)

```typescript
// Example: runInChildContext handler
const durablePromise = new DurablePromise(async () => {
  // Create child context
  const childContext = createDurableContext({
    terminationMethod: parentContext.terminationMethod,
    childPromises: new Set(),
  });

  // Link child context to this promise
  durablePromise.setChildContext(childContext);

  // Execute user function with child context
  return await userFunction(childContext);
});

// Register in parent context
parentContext.childPromises.add(durablePromise);

// Clean up when complete
durablePromise.finally(() => {
  parentContext.childPromises.delete(durablePromise);
});

return durablePromise;
```

#### Using Termination Method in Handlers

```typescript
// In all handlers when termination is needed
const terminationMethod = durablePromise.getTerminationMethod();
return terminationMethod(context, reason, message);
```

### 6. Execution Flow Example

```typescript
// 1. Create root context with default terminate
const rootContext = { terminationMethod: terminate, childPromises: new Set() };

// 2. User creates waitForCallback
const promise1 = context.waitForCallback(async (submit) => {
  // 3. Child context created inside promise1 executor
  const childContext = {
    terminationMethod: rootContext.terminationMethod, // Inherits default
    childPromises: new Set(),
  };

  // 4. Child operations created
  const promise2 = childContext.step(async () => "result");
  const promise3 = childContext.createCallback();

  // promise2 and promise3 registered in childContext.childPromises

  return await promise2;
});

// 5. User attaches custom termination method
promise1.attachTerminationMethod(myTermination);

// 6. Propagation happens:
//    - promise1._terminationMethod = myTermination
//    - childContext.terminationMethod = myTermination
//    - promise2.attachTerminationMethod(myTermination) called
//    - promise3.attachTerminationMethod(myTermination) called

// 7. When operations terminate, they use myTermination
await promise1; // All operations use myTermination
```

## Key Design Decisions

### 1. No Default in DurablePromise

- `DurablePromise` does not have a default termination method
- Context is the single source of truth for termination behavior
- Simplifies logic: promise override OR context default

### 2. Priority Order

```typescript
const terminationMethod =
  durablePromise.getTerminationMethod() || durableContext.terminationMethod;
```

1. **First**: Check if promise has custom method (via `attachTerminationMethod`)
2. **Second**: Use context's termination method (inherited from parent)

### 3. Automatic Propagation

- When `attachTerminationMethod` is called, it recursively propagates to all children
- Works regardless of timing (before or after child operations are created)
- Handles nested children (grandchildren, etc.) automatically

### 4. Memory Management

- Use `Set` for `childPromises` (can iterate for propagation)
- Clean up completed promises in `.finally()` to prevent memory leaks
- Promises are short-lived, so manual cleanup is sufficient

### 5. Child Context Reference

- Only operations that create child contexts store `_childContext`
- Simple operations (step, wait, invoke) don't need this reference
- `setChildContext()` is called inside the executor when child context is created

## Operations by Category

### Create Child Context

These operations create a new `DurableContext` and need `setChildContext()`:

- `runInChildContext`
- `waitForCallback`
- `parallel`
- `map`

### No Child Context

These operations execute within the current context:

- `step`
- `wait`
- `invoke`
- `createCallback`
- `waitForCondition`

## Benefits

1. **Automatic Propagation**: Set once on parent, applies to entire tree
2. **Flexible Override**: Individual operations can still override if needed
3. **Clean API**: No changes to user-facing API
4. **Memory Efficient**: Cleanup via `.finally()`, no memory leaks
5. **Timing Independent**: Works whether `attachTerminationMethod` is called before or after children are created

## Implementation Checklist

- [ ] Add `terminationMethod` and `childPromises` to `DurableContext` interface
- [ ] Remove default from `DurablePromise._terminationMethod`
- [ ] Add `_childContext` field to `DurablePromise`
- [ ] Add `setChildContext()` method to `DurablePromise`
- [ ] Update `attachTerminationMethod()` to propagate to children
- [ ] Update `getTerminationMethod()` to check child context
- [ ] Initialize root context with default `terminate`
- [ ] Update child context creation to inherit `terminationMethod`
- [ ] Update all handlers to register/cleanup in `childPromises`
- [ ] Update handlers with child contexts to call `setChildContext()`
- [ ] Update all handlers to use `getTerminationMethod()`
- [ ] Add tests for propagation behavior
