# Real-World Example: DurablePromise Benefits

## Scenario: Timeout Pattern with Lambda Invocation

### Problem with Eager Promises

```typescript
const handler = async (event: any, ctx: DurableContext) => {
  // ❌ PROBLEM: invoke() starts immediately and might terminate Lambda
  const invokeOp = ctx.invoke("slow-function", { data: event.data });

  // ❌ We might never reach this line if invoke terminates Lambda
  const timeoutOp = ctx.wait({ seconds: 30 });

  // ❌ We definitely never reach Promise.race if Lambda terminated
  const result = await Promise.race([
    invokeOp,
    timeoutOp.then(() => {
      throw new Error("Timeout!");
    }),
  ]);

  return result;
};
```

**What happens:**

1. `ctx.invoke()` executes immediately
2. If it needs to checkpoint and terminate Lambda, it does so
3. Lines after `ctx.invoke()` never execute
4. `Promise.race()` never gets called
5. Timeout protection doesn't work

### Solution with DurablePromise

```typescript
const handler = async (event: any, ctx: DurableContext) => {
  // ✅ SOLUTION: Neither operation starts yet
  const invokeOp = ctx.invoke("slow-function", { data: event.data });
  const timeoutOp = ctx.wait({ seconds: 30 });

  // ✅ Both operations start together when Promise.race calls .then()
  const result = await Promise.race([
    invokeOp,
    timeoutOp.then(() => {
      throw new Error("Timeout!");
    }),
  ]);

  return result;
};
```

**What happens:**

1. `ctx.invoke()` returns `DurablePromise` without executing
2. `ctx.wait()` returns `DurablePromise` without executing
3. `Promise.race()` is reached successfully
4. `Promise.race()` calls `.then()` on both promises
5. Both operations start executing together
6. Timeout protection works correctly

## Scenario: Conditional Execution

### Problem with Eager Promises

```typescript
const handler = async (event: any, ctx: DurableContext) => {
  // ❌ Step executes immediately, even if we don't need it
  const expensiveOp = ctx.step("expensive", async () => {
    return await doExpensiveWork();
  });

  if (event.skipExpensive) {
    // ❌ Too late! expensiveOp already started
    return { skipped: true };
  }

  return await expensiveOp;
};
```

### Solution with DurablePromise

```typescript
const handler = async (event: any, ctx: DurableContext) => {
  // ✅ Step doesn't execute yet
  const expensiveOp = ctx.step("expensive", async () => {
    return await doExpensiveWork();
  });

  if (event.skipExpensive) {
    // ✅ expensiveOp never executes
    return { skipped: true };
  }

  // ✅ Only executes if we reach this line
  return await expensiveOp;
};
```

## Scenario: Dynamic Operation Selection

### Problem with Eager Promises

```typescript
const handler = async (event: any, ctx: DurableContext) => {
  // ❌ All three operations start immediately
  const fastOp = ctx.invoke("fast-service", event);
  const mediumOp = ctx.invoke("medium-service", event);
  const slowOp = ctx.invoke("slow-service", event);

  // ❌ All three Lambdas already invoked, wasting resources
  const selected =
    event.priority === "high"
      ? fastOp
      : event.priority === "medium"
        ? mediumOp
        : slowOp;

  return await selected;
};
```

### Solution with DurablePromise

```typescript
const handler = async (event: any, ctx: DurableContext) => {
  // ✅ No operations execute yet
  const fastOp = ctx.invoke("fast-service", event);
  const mediumOp = ctx.invoke("medium-service", event);
  const slowOp = ctx.invoke("slow-service", event);

  // ✅ Select operation without executing others
  const selected =
    event.priority === "high"
      ? fastOp
      : event.priority === "medium"
        ? mediumOp
        : slowOp;

  // ✅ Only the selected operation executes
  return await selected;
};
```

## Scenario: Parallel Operations with Fallback

### Problem with Eager Promises

```typescript
const handler = async (event: any, ctx: DurableContext) => {
  // ❌ Primary operation starts immediately
  const primary = ctx.invoke("primary-service", event);

  // ❌ If primary terminates Lambda, we never create fallback
  const fallback = ctx.invoke("fallback-service", event);

  // ❌ Never reached if Lambda terminated
  return await Promise.race([
    primary,
    ctx.wait({ seconds: 5 }).then(() => fallback),
  ]);
};
```

### Solution with DurablePromise

```typescript
const handler = async (event: any, ctx: DurableContext) => {
  // ✅ Neither operation starts yet
  const primary = ctx.invoke("primary-service", event);
  const fallback = ctx.invoke("fallback-service", event);

  // ✅ Complex composition works correctly
  return await Promise.race([
    primary,
    ctx.wait({ seconds: 5 }).then(() => fallback),
  ]);
};
```

## Key Takeaway

**DurablePromise enables safe composition of operations that might terminate Lambda execution.**

Without it, any operation that checkpoints and terminates prevents subsequent code from running, breaking promise composition patterns like `Promise.race()`, `Promise.all()`, and conditional execution.
