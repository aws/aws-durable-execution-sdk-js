# Running on Lambda Managed Instances

On [Lambda Managed Instances](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-execution-environment.html)
(LMI), the execution environment does not freeze between invocations. An invocation timeout
does not stop the code that is running. One Node.js worker runs several invocations at the same
time, and they share module-level state
([LMI Node.js runtime](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-nodejs-runtime.html)).
So code from an ended invocation can keep running next to a later invocation, or next to a
retry of the same execution.

The SDK never stops that code by force. A step can stop itself when the SDK aborts its
`ctx.signal`. So follow these rules in a durable function:

1. Keep each step much shorter than the function timeout. When the deadline passes, the SDK
   terminates the invocation: it aborts `ctx.signal` of every running step, sends no further
   checkpoint, and starts no further operation. Lambda retries the invocation. A step that
   was running at the deadline runs again on the retry. Split long work into several steps.
2. Pass `ctx.signal` to every I/O call in a step. The SDK aborts it at the deadline, so the
   step stops instead of running next to the retry:

   ```typescript
   await context.step("load", async (ctx) => {
     const res = await fetch(url, { signal: ctx.signal });
     // Read the body inside the step. The signal also covers the body read,
     // and the step returns plain data that the SDK can checkpoint.
     return res.json();
   });
   ```

   A step that ignores the signal keeps running after the deadline. Its result is not
   checkpointed.

3. Make every step idempotent. Derive the idempotency key from the execution and the step, not
   from the time. A step already runs at least once. On LMI, an old invocation can also run the
   same step at the same time as its retry.
4. The same signal stops leftover steps in a `map` or `parallel`. When the batch
   [completes early](BATCH_COMPLETION.md), the SDK aborts the signal of every step that still
   runs.
5. After `context.promise.race`, the remaining branches keep running, and the SDK does not
   abort their signals. A step that ignores its signal also keeps running. So use
   `promise.race` or such a step only when its leftover work has no side effects, or side
   effects that are safe to repeat.
6. Do not use `finally` around a durable operation for cleanup. When the invocation suspends,
   the code after the `await` never runs, so the `finally` block never runs.
7. Keep no per-invocation state in module-level variables. Concurrent invocations in one worker
   share them.
8. Avoid long synchronous CPU work. It blocks every invocation in the worker, and nothing can
   interrupt it.

Plugin authors: see the remarks on `DurableInstrumentationPlugin` and
`DurableInstrumentationPluginFactory`. Custom transport authors: see
[Custom transport](CUSTOM_TRANSPORT.md).
