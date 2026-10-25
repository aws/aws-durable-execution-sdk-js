# @aws/durable-execution-sdk-js-lite-otel

An OpenTelemetry tracing plugin for
[`@aws/durable-execution-sdk-js-lite`](../aws-durable-execution-sdk-js-lite/README.md).
It sends one trace per durable execution to any OpenTelemetry `SpanExporter`.

To change this package, read [Contributing](#contributing) first.

## Status

This package is an alpha. It is private and not published to npm. Its API can change.

## What it does

A durable execution runs in several Lambda invocations. The plugin builds one trace for
the whole execution. This is the execution view: one span per durable operation, under one
workflow span.

| Span | Name | Parent |
|---|---|---|
| Workflow | the function name from the ARN, else `Workflow` | none (root) |
| Operation | the operation's name, else its type, for example `WAIT` | the enclosing child context, else the workflow span |
| Attempt | `<name> attempt <n>`, one per step attempt and per `waitForCondition` check | the step's operation span |
| Invocation | `Invocation` | the workflow span |

The plugin creates no Tracer and no TracerProvider. It builds finished spans as plain
objects with the fields of `ReadableSpan` from `@opentelemetry/sdk-trace-base` 2.x. Then it
passes them to `exporter.export`, during the invocation and at its end (see
[When spans are sent](#when-spans-are-sent)).

## Requirements

- Node.js 22.12 or later.
- `@opentelemetry/api` 1.9 or later. It is the only peer dependency.
- A `SpanExporter`, for example `OTLPTraceExporter` from
  `@opentelemetry/exporter-trace-otlp-http` or `@opentelemetry/exporter-trace-otlp-proto`.

## Usage

```js
import { withDurableExecution } from "@aws/durable-execution-sdk-js-lite";
import { createOtelPlugin } from "@aws/durable-execution-sdk-js-lite-otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

// Created once per Lambda sandbox. Every invocation shares it.
const exporter = new OTLPTraceExporter({
  url: process.env.OTLP_TRACES_URL,
  headers: { Authorization: `Bearer ${process.env.OTLP_TOKEN}` },
});

export const handler = withDurableExecution(workflow, {
  plugins: [createOtelPlugin({ exporter, serviceName: "orders" })],
});
```

Never write a token into the code. Read it from an environment variable, as above. Or read
it from AWS Secrets Manager once, outside the handler, and create the exporter with it.

## Configuration

`createOtelPlugin(config)` returns a plugin factory. `config` has these keys:

- `exporter` (required): any OpenTelemetry `SpanExporter`. The plugin calls
  `export(spans, resultCallback)` once per batch. It calls `export` again only after the
  previous export settled. It calls `forceFlush()` after a successful export, if the
  exporter has it. It never calls `shutdown()`.
- `resource` (optional): the OpenTelemetry Resource of every span, for example from
  `resourceFromAttributes` of `@opentelemetry/resources` 2.x.
- `serviceName` (optional): `service.name` of the default resource. Ignored when
  `resource` is set.
- `sampleRate` (default 1): the fraction of executions to trace, from 0 to 1.
- `exportTimeoutMs` (default 3000): each export waits at most this many milliseconds.
  `onInvocationEnd` also waits at most this long for all exports.
- `flushIntervalMs` (default 5000): finished operation and attempt spans are sent at most
  this many milliseconds after they end, during the invocation. `0` sends every span at
  the end of the invocation.

The default resource has these attributes. An attribute without a value is omitted.

- `service.name`: `serviceName`, else `AWS_LAMBDA_FUNCTION_NAME`, else `durable-function`.
- `cloud.provider`: `aws`.
- `cloud.region`: `AWS_REGION`.
- `faas.name`: `AWS_LAMBDA_FUNCTION_NAME`.

The OTLP serializer of `@opentelemetry/otlp-transformer` reads only `attributes` and
`schemaUrl` from a resource. The default resource also has the other members of the
Resource interface. To add attributes, pass your own Resource.

### When spans are sent

1. A finished operation span or attempt span goes into a buffer of the invocation. A
   timer sends the buffer at most `flushIntervalMs` after the previous export. So such a
   span is sent during the invocation, at most `flushIntervalMs` after it ends.
2. The invocation span and the workflow span are sent at the end of the invocation.
   `onInvocationEnd` sends them with the rest of the buffer.
3. So a backend can show a child before its parent. This happens within one invocation,
   and across invocations. The trace is complete when the execution ends.
4. A crash or a Lambda timeout skips `onInvocationEnd`. Then the spans that finished in
   the last interval are lost, and the invocation span is lost. The spans of the earlier
   intervals were already sent.
5. Tail sampling in a collector decides per batch of spans. It can drop a parent that
   arrives later than its children. So prefer `sampleRate`.

The lite SDK recommends sending only in `onInvocationEnd`, because it awaits only that
hook. The plugin sends earlier, and still follows the reason for that rule:

1. `onInvocationEnd` awaits every export that started earlier. So no export runs when the
   handler returns.
2. The final export starts after the earlier exports. So `onInvocationEnd` waits at most
   `exportTimeoutMs` in total. When earlier exports still run at that deadline, the final
   batch is not sent, and the plugin logs one line with `console.warn`.
3. The timer is unref'd, so it never keeps a process alive. `onInvocationEnd` clears it.
   A span that ends after `onInvocationEnd` started is dropped.

### Sampling

The plugin decides from the trace id. The trace id is the same in every invocation of one
execution. So every invocation makes the same decision, and a trace is complete or absent.

1. The plugin reads the last 8 hex digits of the trace id as a number.
2. It divides the number by 2^32.
3. The execution is traced if the result is below `sampleRate`.
4. For an execution that is not traced, the factory returns `undefined`. So the SDK calls
   no plugin hook.

## Span model

### Ids

Every invocation of one execution computes the same id for the same span. So a span that
one invocation emits can be the parent of a span that a later invocation emits. Each id is
a prefix of the SHA-256 hex digest of a string. `arn` is the `DurableExecutionArn`.
`operationId` is the record's `Id`.

| Id | Hashed string | Length |
|---|---|---|
| trace id | `arn` | 32 |
| workflow span id | `workflow:` + `arn` | 16 |
| operation span id | `arn` + `:` + `operationId` | 16 |
| attempt span id | `arn` + `:` + `operationId` + `:attempt:` + attempt number | 16 |
| invocation span id | `arn` + `:invocation:` + request id | 16 |

Without a request id, the invocation span id is random.

### Which invocation emits what

1. An operation span is built in the invocation in which its record became terminal. The
   plugin builds it in `onOperationChange`, when a checkpoint response returns the
   terminal record. It builds the remaining ones from the final records in
   `onInvocationEnd`. With `flushIntervalMs` 0, it builds all of them there. Terminal
   statuses are `SUCCEEDED`, `FAILED`, `TIMED_OUT`, `STOPPED` and
   `CANCELLED`.
2. A record that was terminal when the invocation started was emitted by an earlier
   invocation. So it is skipped.
3. The exception to rule 2 is a record in `updatedOperationIds`. The service ended it
   between two invocations, for example a wait or a callback. No earlier invocation saw it
   end. So the next invocation emits it.
4. The span's start and end are the record's `StartTimestamp` and `EndTimestamp`. Without
   `EndTimestamp`, the span ends at the end of the invocation.
5. An attempt span is built when the attempt's `fn` settles. Its times are measured in the
   Lambda function.
6. The invocation span starts when the factory runs. It ends when `onInvocationEnd` runs.
7. The workflow span is emitted only by the invocation whose status is `SUCCEEDED` or
   `FAILED`. It starts at the `EXECUTION` record's `StartTimestamp`.

### Attributes

| Attribute | Spans |
|---|---|
| `durable.execution.arn` | all |
| `durable.operation.id`, `durable.operation.type`, `durable.operation.name`, `durable.operation.subtype` | operation, attempt |
| `durable.operation.status` | operation |
| `durable.attempt.number` | attempt; operation of a `STEP` (`StepDetails.Attempt`) |
| `durable.execution.status` | workflow |
| `faas.invocation_id`, `durable.invocation.status`, `durable.invocation.first` | invocation |

### Status

- An operation span is `OK` for `SUCCEEDED`. Else it is `ERROR`. The message is the
  record's `ErrorMessage`, else the status, for example `TIMED_OUT`.
- A failed operation, a failed attempt and a failed workflow also have one `exception`
  event with `exception.type` and `exception.message`.
- An invocation span is `ERROR` when the invocation status is `FAILED` or `RETRYING`.
  Else it is `OK`.
- The workflow span is `OK` for `SUCCEEDED` and `ERROR` for `FAILED`.

## Context propagation

The plugin makes a durable span the active span while user code runs:

- the attempt span, while a step's `fn` runs;
- the operation span, while a child context's `fn` runs;
- the invocation span, while the workflow function runs.

It does this with `context.with` of `@opentelemetry/api`. This works only with a registered
context manager. A context manager follows the active span across `await`. Register one
once, for example `AsyncLocalStorageContextManager` from
`@opentelemetry/context-async-hooks`:

```js
import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
```

Then spans that your code or an auto-instrumentation creates inside a step are children of
the attempt span. Without a context manager, these spans do not nest under the durable
spans. The plugin's own spans are still complete, because it sets every parent from the
ids above. So a runtime without `AsyncLocalStorage`, for example LLRT, still gets every
durable span.

## Limitations

- A sandbox can crash or time out before `onInvocationEnd` runs. Then the spans of the
  last `flushIntervalMs` and the invocation span are lost.
- A failed export is not retried. The plugin logs one line with `console.warn`.
- A FLAT map or parallel item has no record. So it has no span. Its operations are
  children of the map's span.
- An abandoned operation, for example an item that still ran when a map completed early,
  never becomes terminal. So it has no span.
- A child span is sent before its parent. Until the parent is sent, the backend shows a
  missing parent. See [When spans are sent](#when-spans-are-sent).
- Tail sampling in a collector decides per batch of spans. It can drop a parent that
  arrives in a later batch. Use `sampleRate` instead.
- The real service can report an id in `updatedOperationIds` that an earlier invocation
  already emitted. The span is then sent twice with the same span id.
- The trace is not linked to the AWS X-Ray trace of the Lambda invocation.
- The trace context is not propagated to functions called with `ctx.invoke`.
- Log lines do not carry the trace id or span id.

## Differences from @aws/durable-execution-sdk-js-otel

- This plugin has only the execution view. The full plugin also has an invocation view.
- This plugin builds finished spans and calls the exporter directly. The full plugin uses
  a Tracer, a TracerProvider and a deterministic IdGenerator.
- This plugin derives the trace id from the ARN only. The full plugin can join a
  propagated parent trace or an X-Ray trace.
- This plugin does not use `AsyncLocalStorage`. The full plugin does.
- This plugin has no propagation metadata for chained invokes, no log correlation, no
  context extractors and no loading from a Lambda layer.
- This plugin uses the same attribute names and the same status mapping.

## Contributing

This section is for people and AI agents who change this package. The rules of the lite
SDK's [Contributing](../aws-durable-execution-sdk-js-lite/README.md#contributing) section
apply, with these changes:

1. `package.json` has one peer dependency, `@opentelemetry/api`. It has no `dependencies`,
   no `devDependencies` and no `optionalDependencies`.
2. `src` imports only relative paths, `node:` built-ins and `@opentelemetry/api`. It never
   imports the lite SDK. `src/index.d.ts` imports the lite SDK's types by a relative path,
   because the lite SDK is not linked into the workspace `node_modules`.
3. `src` does not import `node:async_hooks`. Tests may, to register a context manager.
4. No per-invocation state at module level. Shared state lives in the closure of
   `createOtelPlugin`. Per-invocation state lives in the closure of one factory call.
5. A telemetry failure must never fail the workflow. So every export catches and logs its
   failure, and `onInvocationEnd` waits at most `exportTimeoutMs` in total. This is the
   one safeguard that the package adds. Other misuse is documented, not checked.
6. Tests use `runDurable` from the lite SDK's testing module, by a relative path.
7. Before a commit, run `npm test` in this folder and `npx biome check
   packages/aws-durable-execution-sdk-js-lite-otel` from the repository root. Both must
   pass.
8. Commit titles use the scope `sdk-lite-otel`, for example
   `feat(sdk-lite-otel): add execution-view tracing plugin`.

### Files

```
src/index.js     createOtelPlugin: the factory and the hooks
src/ids.js       deterministic ids and the sampling decision
src/spans.js     span objects, time conversion, the default resource
src/export.js    the export with a timeout
src/version.js   the instrumentation scope version
src/index.d.ts   the public types
```
