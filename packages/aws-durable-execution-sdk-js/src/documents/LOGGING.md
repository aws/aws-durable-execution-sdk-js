# Logging

Access enriched logger:

```typescript
const handler = async (event: any, context: DurableContext) => {
  context.logger.info("Processing started", { userId: event.userId });

  try {
    const result = await context.step("process", async (ctx) => {
      ctx.logger.debug("Step executing");
      return processData();
    });

    context.logger.info("Processing completed", { result });
    return result;
  } catch (error) {
    context.logger.error("Processing failed", error);
    throw error;
  }
};
```

Custom logger:

```typescript
context.configureLogger({
  customLogger: {
    log: (level, message, data, error) =>
      console.log(`[${level}] ${message}`, data),
    error: (message, error, data) => console.error(message, error, data),
    warn: (message, data) => console.warn(message, data),
    info: (message, data) => console.info(message, data),
    debug: (message, data) => console.debug(message, data),
  },
  modeAware: false, // Optional: show logs during replay (default: true)
});
```

**Tip for local development:** Set `modeAware: false` to see all logs during replay, which can be helpful for debugging:

```typescript
context.configureLogger({ modeAware: false });
```

## Powertools for AWS Lambda (TypeScript)

`createPowertoolsLogger` wraps a [Powertools `Logger`](https://docs.powertools.aws.dev/lambda/typescript/latest/features/logger/). Every log entry then contains the durable execution metadata: `executionArn`, `requestId`, `tenantId`, `operationId`, `operationName`, and `attempt`. Keys without a value are omitted. Every entry also contains the fields that the configured plugins add, such as the OTel plugin's `traceId` and `spanId`, as entries of the default logger do.

```typescript
import { Logger } from "@aws-lambda-powertools/logger";
import {
  createPowertoolsLogger,
  DurableContext,
  PowertoolsDurableLogger,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

const logger = new Logger({ serviceName: "my-service" });

export const handler = withDurableExecution(
  async (
    event: { orderId: string },
    context: DurableContext<PowertoolsDurableLogger<Logger>>,
  ) => {
    context.configureLogger({ customLogger: createPowertoolsLogger(logger) });
    context.logger.info("workflow-started", { orderId: event.orderId });
  },
);
```

- Declare `context` as `DurableContext<PowertoolsDurableLogger<Logger>>`, as above. Then `context.logger` and the step loggers accept the Powertools argument types. Without the declaration, `context.logger` accepts any arguments.
- The keys use the same names as the default logger and the Python SDK.
- A key passed in the log call replaces the metadata key with the same name. The metadata replaces keys set with `appendKeys` or `persistentKeys`, because Powertools applies per-call keys after those.
- The adapter reads the metadata on every call. So one adapter instance logs the correct `operationId` and `attempt` for concurrent steps and child contexts.
- Powertools reads only `message` from an `Error` passed as the first argument, and writes no stack. To log the stack, pass the `Error` as a later argument: `context.logger.error("charge failed", error)`.
- The SDK does not depend on `@aws-lambda-powertools/logger`. Install it in your function.
- `logger.addContext(context.lambdaContext)` adds the Powertools Lambda context fields, such as `cold_start` and `function_name`. It also adds `function_request_id`, which repeats `requestId`. For a tenant-scoped execution it adds `tenant_id`, which repeats `tenantId`. Powertools stores these fields on the `Logger` instance. So when several invocations run at the same time in one process, as on Lambda Managed Instances, they carry the values of the invocation that called `addContext` last. The durable metadata fields do not have this problem.

Leave the `POWERTOOLS_DEV` environment variable unset in deployed functions. When it is set, Powertools writes through the global `console`. With Lambda's JSON log format, Lambda wraps each `console` line in a JSON object. So each Powertools entry then appears as a string inside the `message` field of a second JSON object.

The `powertools-logger` example used to define its own adapter class, which wrote snake_case keys (`execution_arn`, `request_id`, `operation_id`). `createPowertoolsLogger` writes camelCase keys. If you copied that example, update log queries and metric filters to the camelCase names.
