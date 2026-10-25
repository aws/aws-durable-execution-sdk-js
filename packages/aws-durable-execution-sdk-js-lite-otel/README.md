# @aws/durable-execution-sdk-js-lite-otel

An OpenTelemetry tracing plugin for
[`@aws/durable-execution-sdk-js-lite`](../aws-durable-execution-sdk-js-lite/README.md).
It sends the spans of each durable execution to any OpenTelemetry `SpanExporter`. An
execution that `ctx.invoke` started joins the caller's trace.

To change this package, read [Contributing](#contributing) first.

## Status

This package is an alpha. It is private and not published to npm. Its API can change.

## What it does

A durable execution runs in several Lambda invocations. The plugin builds one trace for
the whole execution. This is the execution view: one span per durable operation, under one
workflow span.

| Span | Name | Parent |
|---|---|---|
| Workflow | the function name from the ARN, else `Workflow` | none (root); a link to the trace header's Parent |
| Operation | the operation's name, else its type, for example `WAIT` | the enclosing child context, else the workflow span |
| Attempt | `<name> attempt <n>`, one per step attempt and per `waitForCondition` check | the step's operation span |
| Invocation | `Invocation` | the workflow span |

The plugin creates no Tracer and no TracerProvider. It builds finished spans as plain
objects with the fields of `ReadableSpan` from `@opentelemetry/sdk-trace-base` 2.x. Then it
passes them to `exporter.export`, during the invocation and at its end (see
[When spans are sent](#when-spans-are-sent)).

## Requirements

- Node.js 22.12 or later. The package has no dependencies.
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
- `otelApi` (optional): your `@opentelemetry/api` module namespace (`import * as api`),
  or an object `{ context, trace }`. The plugin calls only `context.active()`,
  `context.with(context, fn)` and `trace.setSpanContext(context, spanContext)`. It does
  not check the object. Without `otelApi`, the plugin finds the context manager of
  `@opentelemetry/api` 1.x itself. See [Context propagation](#context-propagation).

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

The plugin decides from the trace id (see [Trace id](#trace-id)). The trace id is the
same in every invocation of one execution. So every invocation makes the same decision,
and a trace is complete or absent. An execution that `ctx.invoke` started has the
caller's trace id. So with the same `sampleRate`, it makes the caller's decision.

1. The plugin reads the last 8 hex digits of the trace id as a number.
2. It divides the number by 2^32.
3. The execution is traced if the result is below `sampleRate`.
4. For an execution that is not traced, the factory returns `undefined`. So the SDK calls
   no plugin hook.

The plugin ignores the `Sampled` field of the trace header:

1. In PassThrough tracing without an upstream decision, Lambda sets `Sampled=0`.
2. That is the common case for a durable function. For example, `aws lambda invoke`
   sends no trace header.
3. So a plugin that obeyed `Sampled` would trace almost no execution.
4. So only `sampleRate` decides.

## Span model

### Trace id

1. Lambda gives every invocation a trace header in the X-Ray format, for example
   `Root=1-6a0b1c2d-0123456789abcdef01234567;Parent=89abcdef01234567;Sampled=1`. The
   invocation reads it from `lambdaContext.xRayTraceId` and from
   `process.env._X_AMZN_TRACE_ID`.
2. Lambda Managed Instances run several invocations in one process at the same time. So
   `_X_AMZN_TRACE_ID` can belong to another invocation. So the plugin reads
   `lambdaContext.xRayTraceId`, and reads the environment variable only when
   `lambdaContext.xRayTraceId` is absent.
3. If the header has a valid `Root=1-<8 hex>-<24 hex>`, the trace id is those 32 hex
   digits. Else the trace id is the SHA-256 of the ARN (see [Ids](#ids)). On Lambda,
   every invocation has a header. So the ARN hash is used only outside Lambda, for
   example in tests.
4. The service gives every invocation of one execution the same Root. So every
   invocation of the execution computes the same trace id.

Because the trace id is the X-Ray Root:

1. The execution's spans are in the same trace as the Lambda X-Ray segments of its
   invocations.
2. If the upstream caller was traced, for example API Gateway with X-Ray, Lambda keeps its
   Root. So the execution's spans are in the upstream caller's trace.
3. So two executions that one upstream request started share one trace. Each has its own
   workflow span as a root.
4. An execution that `ctx.invoke` started gets the caller's Root (see
   [Propagation through ctx.invoke](#propagation-through-ctxinvoke)).

### Ids

Every invocation of one execution computes the same id for the same span. So a span that
one invocation emits can be the parent of a span that a later invocation emits. Each span
id is a prefix of the SHA-256 hex digest of a string. `arn` is the `DurableExecutionArn`.
`operationId` is the record's `Id`.

| Id | Hashed string | Length |
|---|---|---|
| trace id | the 32 hex digits of the trace header's `Root`; without a valid `Root`, `arn` | 32 |
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
3. The exception to rule 2 is a WAIT, CALLBACK or CHAINED_INVOKE record in
   `updatedOperationIds`. The service ends these records. It can end one between two
   invocations, for example when a wait's time passes. Then no earlier invocation saw it
   end. So the next invocation emits it.
4. Only the SDK ends a STEP or CONTEXT record. So an earlier invocation always saw it end.
   After an invocation times out, the service lists every record that invocation changed
   in `updatedOperationIds`. The interval flush already sent most of those spans. So a
   STEP or CONTEXT record in `updatedOperationIds` is still skipped. If an invocation
   crashes, its spans that finished in the last interval are lost.
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
| `durable.trace.header_parent`: the `Parent` of the trace header, if valid | workflow |
| `faas.invocation_id`, `durable.invocation.status`, `durable.invocation.first` | invocation |

### Status

- An operation span is `OK` for `SUCCEEDED`. Else it is `ERROR`. The message is the
  record's `ErrorMessage`, else the status, for example `TIMED_OUT`.
- A failed operation, a failed attempt and a failed workflow also have one `exception`
  event with `exception.type` and `exception.message`.
- An invocation span is `ERROR` when the invocation status is `FAILED` or `RETRYING`.
  Else it is `OK`.
- The workflow span is `OK` for `SUCCEEDED` and `ERROR` for `FAILED`.

## Propagation through ctx.invoke

The lite SDK calls the plugin's `traceHeader` hook when `ctx.invoke` sends its START. The
hook returns this header:

```
Root=1-<first 8 hex of the trace id>-<last 24 hex>;Parent=<span id of the CHAINED_INVOKE operation>;Sampled=1
```

1. The SDK sends it as `ChainedInvokeOptions.XAmznTraceId`.
2. The service gives it to the invoked execution as its Lambda trace header, in every
   invocation. Lambda appends a `Lineage` field.
3. So the invoked execution's trace id is the caller's trace id. Both executions are in
   one trace.
4. `Sampled` is 1, because the plugin exists only in a traced execution. An untraced
   caller has no plugin, so it sends no header. The service then gives the invoked
   execution the caller's own header. Its Root gives the caller's trace id, so the
   invoked execution is untraced too.

The invoked execution's workflow span has a link to the header's `Parent`. The link has
the attribute `durable.link` = `invoker`. The workflow span has no parent. The reasons:

1. A parent must be a span in the trace. Else the backend shows a broken tree.
2. In PassThrough tracing, Lambda keeps the `Parent` that the caller sent. So `Parent` is
   the caller's CHAINED_INVOKE span. That span exists.
3. In Active tracing, Lambda replaces `Parent` in every invocation with a span of its own.
   This plugin never exports that span.
4. A top-level execution has a `Parent` too: a Lambda span or a span of the upstream
   caller. This plugin never exports these spans either.
5. A link can point to a span that does not exist.
6. So the workflow span stays a root span, and links to `Parent`.

The final invocation emits the workflow span. So the link uses the `Parent` of that
invocation's header. So a trace with one `ctx.invoke` has two root spans: the caller's
workflow span and the invoked execution's workflow span.

## Context propagation

The plugin makes a durable span the active span while user code runs:

- the attempt span, while a step's `fn` runs;
- the operation span, while a child context's `fn` runs;
- the invocation span, while the workflow function runs.

Then spans that your code or an auto-instrumentation creates inside a step are children of
the attempt span. This needs a context manager that you register with
`@opentelemetry/api`. A context manager follows the active span across `await`. Register
one once, for example `AsyncLocalStorageContextManager` from
`@opentelemetry/context-async-hooks`:

```js
import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
```

The `register()` of a `NodeSDK` or a `NodeTracerProvider` registers one too.

The plugin does not import `@opentelemetry/api`. It reaches the API in one of two ways.

### With otelApi

Pass the API to the plugin. Use this way when your code already imports the API.

```js
import * as api from "@opentelemetry/api";

createOtelPlugin({ exporter, otelApi: api });
```

1. The plugin calls `api.trace.setSpanContext(api.context.active(), spanContext)`. The
   result is a context that holds a non-recording span of the durable span's ids.
2. It runs user code with `api.context.with(thatContext, fn)`.
3. These are public functions of the API. So this way works with every API version that
   keeps them, also a future major version.

### Without otelApi

The plugin finds the context manager of `@opentelemetry/api` 1.x itself:

1. Several copies of the API can be loaded in one process. So the API keeps one shared
   registry on `globalThis`, under `Symbol.for("opentelemetry.js.api.1")`.
2. `context.setGlobalContextManager` stores the context manager in that registry.
3. The active span is the value of the context key
   `Symbol.for("OpenTelemetry Context Key SPAN")`.
4. So the plugin reads the context manager from the registry. It calls the manager's
   `with` with a context that holds a non-recording span of the durable span's ids.
5. So `trace.getActiveSpan()` in user code returns that span.

The plugin looks up the registry when it first runs user code. It keeps a registry that it
found. It looks again on every run while it finds none. So a context manager that you
register after you create the plugin, for example with `NodeSDK.start()`, is used.

Another major version of the API stores its registry under another key, for example
`Symbol.for("opentelemetry.js.api.2")`. The plugin does not know that registry's layout:

1. So it does not use that registry. User code runs, and user spans do not nest under
   the durable spans.
2. It logs one line with `console.warn`, once per process for each such major version.
   The line names the registry's version and recommends `otelApi`.
3. The durable spans are unaffected.

### Without a context manager

Without a registered context manager, user spans do not nest under the durable spans. The
plugin's own spans are still complete, because it sets every parent from the ids above. So
a runtime without `AsyncLocalStorage`, for example LLRT, still gets every durable span.

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
- The real service can list a wait, a callback or an invoke in `updatedOperationIds` after
  an earlier invocation already emitted it. That happens after an invocation timeout. The
  span is then sent twice with the same span id.
- The plugin does not export to X-Ray. It only uses the X-Ray Root as its trace id. The
  Lambda X-Ray segments appear in the trace only if the function sends X-Ray data, for
  example with Active tracing and an OpenTelemetry X-Ray integration. The durable spans
  have no parent link to those segments.
- In Active tracing, the invoked execution's workflow span links to a span that Lambda
  generated, not to the caller's CHAINED_INVOKE span. Lambda replaces `Parent` in every
  invocation. Both executions still share one trace id.
- The workflow span of a top-level execution links to a Lambda or upstream span that
  this plugin does not export.
- Log lines do not carry the trace id or span id.
- Without `otelApi`, nesting depends on the internal registry layout of
  `@opentelemetry/api` major version 1 (see [Context propagation](#context-propagation)).
  With only another major version loaded, user spans do not nest under the durable spans.
  The plugin logs one warning. The durable spans are unaffected. Pass `otelApi` to avoid
  this.
- The plugin does not check `otelApi`. If the object lacks one of the three functions,
  the plugin throws a `TypeError` when it runs user code.

## Differences from @aws/durable-execution-sdk-js-otel

- This plugin has only the execution view. The full plugin also has an invocation view.
- This plugin builds finished spans and calls the exporter directly. The full plugin uses
  a Tracer, a TracerProvider and a deterministic IdGenerator.
- This plugin takes the trace id from the trace header's Root, else from the ARN. It
  never uses the header's `Parent` as a parent. It links the workflow span to it. It
  ignores `Sampled`. The full plugin can also join a W3C parent and reads the
  `Sampled` flag.
- This plugin does not use `AsyncLocalStorage`. The full plugin does.
- This plugin has no dependencies. The full plugin has peer dependencies, among them
  `@opentelemetry/api`.
- This plugin propagates to chained invokes with the lite SDK's `traceHeader` hook. It has
  no log correlation, no context extractors and no loading from a Lambda layer.
- This plugin uses the same attribute names and the same status mapping.

## Contributing

This section is for people and AI agents who change this package. The rules of the lite
SDK's [Contributing](../aws-durable-execution-sdk-js-lite/README.md#contributing) section
apply, including rule 1.9: return to the design phase when a review round finds new
blocking problems after the previous findings were addressed; rule 1.10: prefer
simplifying existing logic to adding logic; and rule 1.11: reviewers push back on a change
that breaks a rule instead of asking for code changes. The rules below add to them
or replace them for this package:

1. `package.json` has no `dependencies`, no `peerDependencies`, no `devDependencies` and
   no `optionalDependencies`.
2. `src` imports only relative paths and `node:` built-ins. It never imports the lite SDK
   or `@opentelemetry/api`. `src/index.d.ts` defines the OpenTelemetry types it needs, with
   the shapes of the API's types. It imports the lite SDK's types by a relative path,
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
src/otel-context.js  the active span, through otelApi or the registry of @opentelemetry/api 1.x
src/version.js   the instrumentation scope version
src/index.d.ts   the public types
```
