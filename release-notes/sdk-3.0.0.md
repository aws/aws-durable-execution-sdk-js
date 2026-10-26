# SDK 3.0.0 / OTel 2.0.0 / Testing SDK 1.3.2

This release contains Core 3.0.0, OTel 2.0.0, Testing SDK 1.3.2, Telemetry
Exporter 0.1.0-alpha.1, Telemetry MCP 0.1.0-alpha.1 and ESLint plugin 1.2.0.
Core 3 and OTel 2 are major releases for plugin authors. Upgrade them together.
The [2.x to 3.0 migration guide](../docs/migration-2.x-to-3.0.md) lists the
porting steps.

# @aws/durable-execution-sdk-js 3.0.0

## Breaking and behavior changes

- `DurableExecutionConfig.plugins` accepts factory objects with a synchronous
  `createPlugin(info)` method. The SDK calls it once per invocation. So plugin
  state no longer crosses concurrent Lambda Managed Instances requests. A v1
  provider or a plugin instance fails with `PluginLoadError`. 6597e075
- The SDK no longer awaits `onOperationStart`, `onOperationEnd`,
  `onOperationAttemptStart`, `onOperationAttemptEnd` or `onOperationChange`.
  The synchronous part of each hook still runs in call order. The asynchronous
  parts can overlap. Before `onInvocationEnd`, the SDK waits for that work until
  500 ms before the deadline. It waits for `onInvocationEnd` until 50 ms before
  the deadline. 4e4e9407
- A failed `context.invoke` throws `InvokeError` as before. Its `cause.name` is
  now the invoked function's error type, not `"Error"`. a0d310f5
- The SDK suspends an idle invocation 3 ms after the last operation goes idle,
  not 20 ms. The SDK does not track an `await` in handler code between two
  operations. So such an `await` longer than 3 ms can let the invocation suspend
  before the next operation starts. c0a7e349

## Fixes and additions

- Factories and hooks receive the invocation-local `context.xRayTraceId`
  carrier. 6597e075
- `createPowertoolsLogger` adds durable context to Powertools log entries.
  3542d025
- A reused logger takes its identity from the active execution context.
  eacf9df2
- An operation stays `EXECUTING` while its result is deserialized. Before, a
  slow deserializer next to a pending callback could let the invocation suspend
  early. A deserializer that fails slowly now fails the invocation. a6428832
- A `wrap` hook that rejects for its own reasons no longer fails the
  invocation. A context without a usable `getRemainingTimeInMillis` counts as
  having no deadline. 4e4e9407
- The instrumentation plugin interface is no longer `@experimental` or `@beta`.
  8e5e3a44
- After a `map` or `parallel` completes early, the invocation can suspend
  again. Before, a still-running step in an abandoned item blocked suspension.
  0cb2d80f
- A resumed `map` or `parallel` keeps every recorded item outcome. No item
  starts after the batch resolves. 2e98408d, f753d364

# @aws/durable-execution-sdk-js-otel 2.0.0

## Breaking changes

- `createExecutionOtelPluginFactory` and `createInvocationOtelPluginFactory`
  replace constructing the plugin classes. OTel 2 requires Core
  `>=3.0.0 <4.0.0`, also in Lambda layers. 6597e075
- The execution view reports `faas.max_memory` in bytes, not MiB. So a 1024 MiB
  function reports `1073741824`. Update queries and alarms that read it.
  e049d07c

## Fixes

- Spans, operation maps, replay state and clocks belong to each plugin
  instance. The provider stays shared. 6597e075
- Trace and sampling data come from the invocation-local carrier. 6597e075

See the [OTel migration reference](../packages/aws-durable-execution-sdk-js-otel/README.md#migration-from-the-v1-provider-contract).

# @aws/durable-execution-sdk-js-testing 1.3.2

- The Core peer range is `>=1.0.1 <4.0.0`. So it accepts Core 3. 6597e075
- A settled invocation no longer starts an extra invocation from a queued
  wakeup. 9462cd92
- The cloud runner stores an operation before it notifies history waiters.
  417497f0
- Skip-time keeps checkpoint timestamps, delays and nested invocations on the
  runner's clock. bcb41eba
- An abandoned durable invoke no longer holds its caller's fake clock. 8b8ebe88
- Skip-time keeps advancing after a runner's clock hold expires. e9689d7e

Upgrade the Testing SDK before Core 3. Testing SDK 1.3.1 excludes Core 3 from
its peer range. A timer inside a step runs in real time. Use a durable wait to
test a durable delay. The corrected scheduling can change recorded invocation
counts and history order.

# @aws/durable-execution-sdk-js-telemetry-exporter 0.1.0-alpha.1

- Every error carries its cause chain as `{ name, message, cause? }`. A record
  whose causes were removed to fit a size limit has `droppedCauses: true`.
  2e9031d4, e25244ad
- `SQSExporter` hashes a FIFO group or deduplication id longer than 128
  characters. Before, SQS rejected these sends. 2e9031d4
- `emittedAt` strictly increases within an invocation. Before, two records in
  one millisecond collided in SQS and DynamoDB. 2676e48c

The package remains a preview on the `beta` dist-tag.

# @aws/durable-execution-sdk-js-telemetry-mcp 0.1.0-alpha.1

- `list_executions` validates `since` and `until`, and reads a bound without an
  offset as UTC. 9840138c
- The bundled Athena DDL uses `timestamp` time columns, keeps key case and adds
  `droppedcauses`. e25244ad, 9840138c, 16b6f28b
- `test_destination` no longer requires `DURABLE_TELEMETRY_ATHENA_S3_LOCATION`
  for the `s3` destination. 16b6f28b

The package remains a preview on the `beta` dist-tag.

# @aws/durable-execution-sdk-js-eslint-plugin 1.2.0

- The new rule `require-durable-operation-in-child-context` reports a child
  context function that calls no durable operation. It is not in
  `flat/recommended`. 3cbb456c, e2f013fa
