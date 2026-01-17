# OpenTelemetry Span Attributes

This document lists the attributes added by each OpenTelemetry span wrapper in
`src/utils/otel/otel-instrumentation.ts`.

## Common Attributes

These attributes are set when provided via `OperationSpanOptions` and are shared
by all wrappers.

| Attribute                     | Example Value                                 | Notes                              |
| ----------------------------- | --------------------------------------------- | ---------------------------------- |
| `durable.operation.type`      | `step`                                        | Wrapper-specific operation type    |
| `durable.operation.sub_type`  | `Step`                                        | Wrapper-specific operation subtype |
| `durable.operation.id`        | `step-123`                                    | Operation ID passed by the handler |
| `durable.operation.name`      | `fetch-user`                                  | Optional name parameter            |
| `durable.execution.arn`       | `arn:aws:states:us-east-1:123:execution:exec` | Durable execution ARN              |
| `durable.operation.parent_id` | `parent-1`                                    | Parent operation ID                |
| `durable.operation.attempt`   | `2`                                           | Retry attempt number               |
| `durable.execution.mode`      | `ExecutionMode`                               | Execution or replay mode           |

## Span Wrappers

### `withStepSpan`

| Attribute                    | Example Value | Notes                            |
| ---------------------------- | ------------- | -------------------------------- |
| `durable.step.id`            | `step-123`    | Always set                       |
| `durable.step.name`          | `fetch-user`  | Only when `stepName` is provided |
| `durable.operation.type`     | `step`        | Always set                       |
| `durable.operation.sub_type` | `Step`        | Always set                       |
| `durable.operation.id`       | `step-123`    | Always set                       |
| `durable.operation.name`     | `fetch-user`  | Only when `stepName` is provided |

### `withParallelBranchSpan`

| Attribute                      | Example Value       | Notes                              |
| ------------------------------ | ------------------- | ---------------------------------- |
| `durable.parallel.branch.id`   | `parallel-branch-0` | Always set                         |
| `durable.parallel.branch.name` | `branch-A`          | Only when `branchName` is provided |
| `durable.operation.type`       | `parallel-branch`   | Always set                         |
| `durable.operation.sub_type`   | `ParallelBranch`    | Always set                         |
| `durable.operation.id`         | `parallel-branch-0` | Always set                         |
| `durable.operation.name`       | `branch-A`          | Only when `branchName` is provided |

Note: In the SDK’s `parallel()` implementation, branch spans are emitted via
`withRunInChildContextSpan` with `ParallelBranch` attributes to avoid duplicate
wrappers. `withParallelBranchSpan` is available but not used by default.

### `withRunInChildContextSpan`

| Attribute                    | Example Value          | Notes                        |
| ---------------------------- | ---------------------- | ---------------------------- |
| `durable.child-context.id`   | `child-ctx-1`          | Always set                   |
| `durable.child-context.name` | `process-batch`        | Only when `name` is provided |
| `durable.operation.type`     | `run-in-child-context` | Always set                   |
| `durable.operation.sub_type` | `RunInChildContext`    | Always set                   |
| `durable.operation.id`       | `child-ctx-1`          | Always set                   |
| `durable.operation.name`     | `process-batch`        | Only when `name` is provided |

Note: This span wrapper is also used for `parallel` branches (with `ParallelBranch` subType and additional `durable.parallel.branch.*` attributes) and `map` iterations (with `MapIteration` subType and additional `durable.map.item.*` attributes). See the respective sections for details.

### `withWaitSpan`

| Attribute                       | Example Value | Notes                            |
| ------------------------------- | ------------- | -------------------------------- |
| `durable.wait.id`               | `wait-456`    | Always set                       |
| `durable.wait.name`             | `cooldown`    | Only when `waitName` is provided |
| `durable.wait.duration.seconds` | `300`         | Always set                       |
| `durable.operation.type`        | `wait`        | Always set                       |
| `durable.operation.sub_type`    | `Wait`        | Always set                       |
| `durable.operation.id`          | `wait-456`    | Always set                       |
| `durable.operation.name`        | `cooldown`    | Only when `waitName` is provided |

### `withMapSpan`

| Attribute                    | Example Value | Notes                           |
| ---------------------------- | ------------- | ------------------------------- |
| `durable.operation.type`     | `map`         | Always set                      |
| `durable.operation.sub_type` | `Map`         | Always set                      |
| `durable.operation.id`       | `map-users`   | Falls back to `map`             |
| `durable.operation.name`     | `map-users`   | Only when `mapName` is provided |

Note: In the SDK's `map()` implementation, the outer map span wrapper is not used to avoid duplicate spans. Map operations are represented by the `runInChildContext` span for the overall map operation (with `Map` subType) and individual iteration spans (with `MapIteration` subType). `withMapSpan` is available but not used by default.

### `withMapIterationSpan`

| Attribute                    | Example Value   | Notes                            |
| ---------------------------- | --------------- | -------------------------------- |
| `durable.map.item.index`     | `3`             | Always set                       |
| `durable.map.item.id`        | `map-item-3`    | Always set                       |
| `durable.map.item.name`      | `user-42`       | Only when `itemName` is provided |
| `durable.operation.type`     | `map-iteration` | Always set                       |
| `durable.operation.sub_type` | `MapIteration`  | Always set                       |
| `durable.operation.id`       | `map-item-3`    | Always set                       |
| `durable.operation.name`     | `user-42`       | Only when `itemName` is provided |

Note: In the SDK's `map()` implementation, iteration spans are emitted via `withRunInChildContextSpan` with `MapIteration` attributes to avoid duplicate wrappers. `withMapIterationSpan` is available but not used by default.

### `withInvokeSpan`

| Attribute                    | Example Value                                   | Notes                        |
| ---------------------------- | ----------------------------------------------- | ---------------------------- |
| `durable.invoke.function_id` | `arn:aws:lambda:us-east-1:123:function:handler` | Always set                   |
| `durable.operation.type`     | `invoke`                                        | Always set                   |
| `durable.operation.sub_type` | `ChainedInvoke`                                 | Always set                   |
| `durable.operation.id`       | `invoke-1`                                      | Always set                   |
| `durable.operation.name`     | `invoke-user`                                   | Only when `name` is provided |

### `withCallbackSpan`

| Attribute                    | Example Value | Notes                        |
| ---------------------------- | ------------- | ---------------------------- |
| `durable.operation.type`     | `callback`    | Always set                   |
| `durable.operation.sub_type` | `Callback`    | Always set                   |
| `durable.operation.id`       | `callback-1`  | Always set                   |
| `durable.operation.name`     | `callback`    | Only when `name` is provided |

### `withWaitForCallbackSpan`

| Attribute                    | Example Value       | Notes                        |
| ---------------------------- | ------------------- | ---------------------------- |
| `durable.operation.type`     | `wait-for-callback` | Always set                   |
| `durable.operation.sub_type` | `WaitForCallback`   | Always set                   |
| `durable.operation.id`       | `wait-callback-1`   | Always set                   |
| `durable.operation.name`     | `wait-for-callback` | Only when `name` is provided |

### `withWaitForConditionSpan`

| Attribute                    | Example Value        | Notes                        |
| ---------------------------- | -------------------- | ---------------------------- |
| `durable.operation.type`     | `wait-for-condition` | Always set                   |
| `durable.operation.sub_type` | `WaitForCondition`   | Always set                   |
| `durable.operation.id`       | `wait-condition-1`   | Always set                   |
| `durable.operation.name`     | `wait-for-condition` | Only when `name` is provided |

### `withExecutionSpan`

| Attribute                    | Example Value       | Notes      |
| ---------------------------- | ------------------- | ---------- |
| `durable.operation.type`     | `execution`         | Always set |
| `durable.operation.sub_type` | `Execution`         | Always set |
| `durable.operation.id`       | `durable-execution` | Always set |
| `durable.operation.name`     | `durable-execution` | Always set |
