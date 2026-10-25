# Migrating from 2.x to 3.0

`3.0` is a major release. Its breaking changes for plugin authors include the
[per-invocation plugin factory contract](#register-plugin-factories) and
[non-blocking operation hooks](#adapt-operation-hook-scheduling).
Upgrade the OTel package to `2.x` together with Core `3.x`, including packages
delivered through Lambda layers.

Applications that register no plugins, select none through
`DURABLE_EXECUTION_PLUGINS`, and ship no plugin providers can update their core
dependency without changing their handler or durable operation calls. They should
still review the [behavior changes outside plugins](#review-behavior-changes-outside-plugins).
This guide covers migration from Core `2.x`; the
[release notes](../release-notes/sdk-3.0.0.md) describe the full package scope.

## Why upgrade to 3.0

- **Plugin state is isolated between invocations.** Each Lambda invocation gets
  fresh instrumentation, including concurrent invocations in Lambda Managed
  Instances. Spans and operation buffers belong to the invocation they describe.
- **Resource ownership is explicit.** Factories can reuse a
  provider or exporter while creating separate invocation state.
- **Trace context follows the invocation.** Factories and hooks receive the
  invocation-local `xRayTraceId` carrier, avoiding another invocation's process
  header when the runtime supplies a carrier.

## Porting to 3.0

The changes most likely to touch your code are the `plugins` argument,
environment-loaded providers, OTel registrations, and custom operation hooks. Use
[Finding affected code](#finding-affected-code) to locate them before upgrading.

| Core 2.x / OTel 1.x | Core 3.x / OTel 2.x |
| --- | --- |
| `plugins: [pluginInstance]` | `plugins: [factoryObject]` |
| `DurableInstrumentationPluginProvider` with `pluginApiVersion`, `pluginType`, and `createPlugin()` | `DurableInstrumentationPluginFactory` with `createPlugin(info)` |
| `new InvocationOtelPlugin(config)` registration | `createInvocationOtelPluginFactory(config)` |
| `new ExecutionOtelPlugin(config)` registration | `createExecutionOtelPluginFactory(config)` |
| Registration metadata on the plugin instance or constructor | Metadata on the registered factory |
| SDK awaits operation-hook promises before continuing | Synchronous state setup; explicitly queued asynchronous work when order matters |

### Upgrade dependencies together

The coordinated release uses the following versions and requires Node.js 22 or
later:

| Package | Version | Core compatibility |
| --- | --- | --- |
| `@aws/durable-execution-sdk-js` | `3.0.0` | Core SDK |
| `@aws/durable-execution-sdk-js-otel` | `2.0.0` | `>=3.0.0 <4.0.0` |
| `@aws/durable-execution-sdk-js-testing` | `1.3.2` | `>=1.0.1 <4.0.0` |

After publication, update the packages your application uses and regenerate its
lock file. If you use the Testing SDK, upgrade it first: `1.3.1` excludes Core 3
from its peer range, while `1.3.2` supports both Core 2 and Core 3. Keeping a
pinned `1.3.1` while installing Core 3 can cause npm to reject the install with
`ERESOLVE`.

```bash
npm install --save-dev @aws/durable-execution-sdk-js-testing@1.3.2
npm install @aws/durable-execution-sdk-js@3.0.0 \
  @aws/durable-execution-sdk-js-otel@2.0.0
npm ls @aws/durable-execution-sdk-js @aws/durable-execution-sdk-js-otel
```

OTel is optional. If you use it, retain the provider/exporter setup described in
the [OTel installation guide](../packages/aws-durable-execution-sdk-js-otel/README.md#installation).
Upgrading the package alone does not configure trace export.

Rebuild application bundles and custom provider packages, and update attached
layers that contain Core or OTel. Updating the function's `package.json` does not
update layer versions. Core 3 rejects the OTel 1.x provider contract, and OTel 2
requires Core 3. Verify the versions resolved by the deployed function, not just
the versions in your source tree.

### Register plugin factories

`DurableExecutionConfig.plugins` now accepts factory objects with a synchronous
`createPlugin(info)` method. Return a fresh plugin on every call. The factory
receives the same `InvocationInfo` object passed to `onInvocationStart`.

```typescript
// Core 2.x: one instance registered with the handler
const handler = withDurableExecution(myHandler, {
  plugins: [new AuditPlugin()],
});
```

```typescript
// Core 3.0: each invocation gets a new instance
import {
  withDurableExecution,
  type DurableInstrumentationPlugin,
  type DurableInstrumentationPluginFactory,
  type OperationInfo,
} from "@aws/durable-execution-sdk-js";

class AuditPlugin implements DurableInstrumentationPlugin {
  private readonly operationIds = new Set<string>();

  constructor(private readonly executionArn: string) {}

  async onOperationEnd(info: OperationInfo): Promise<void> {
    this.operationIds.add(info.id);
  }

  async onInvocationEnd(): Promise<void> {
    console.info({
      executionArn: this.executionArn,
      operationIds: [...this.operationIds],
    });
  }
}

const auditFactory: DurableInstrumentationPluginFactory = {
  createPlugin(info) {
    return new AuditPlugin(info.executionArn);
  },
};

export const handler = withDurableExecution(
  async (_event, context) => context.step("work", async () => "ok"),
  { plugins: [auditFactory] },
);
```

A bare function or plugin class without a `createPlugin` member is not a factory.
For example, `plugins: [(info) => new AuditPlugin(info.executionArn)]` is invalid.
Do not return a cached plugin from a factory; that would share its state across
invocations again.

Invalid registrations fail with `PluginLoadError` when the handler's plugin
configuration is resolved. A valid factory that throws or returns `null` or
`undefined` instead skips instrumentation for that invocation. Async factories
are unsupported: Promise-like results are skipped. Keep shared resource setup
outside `createPlugin`, and verify telemetry independently of handler success.

### Adapt operation hook scheduling

Core 3 no longer awaits the promises returned by `onOperationStart`,
`onOperationEnd`, `onOperationAttemptStart`, `onOperationAttemptEnd`, or
`onOperationChange` before continuing an operation. Their asynchronous work
cannot delay the next operation or prevent invocation suspension. Migrating to
a factory alone does not adapt a plugin that relied on those waits.

Hook calls still follow lifecycle order, including
`parent start → child start → child end → parent end` for nested operations.
Each hook's synchronous part runs before the SDK continues, but asynchronous
work from consecutive hooks can overlap and finish out of order. For example,
a child's asynchronous `onOperationEnd` work can finish after its parent's.

Update custom plugins as follows:

- Initialize state needed by later hooks or wrappers synchronously, before the
  first `await` or queued callback. For example, create and store an operation's
  span in `onOperationStart` before awaiting export or enrichment. If the span
  is stored after an `await`, a wrapper can run before that span exists.
- If asynchronous work must preserve hook call order, serialize it explicitly
  in an invocation-local queue or promise chain. Return the queued work's
  promise from each hook so the SDK can track it for draining. Handle rejected
  work so one failure does not prevent later queued work from running.
- Flush exporters and other buffered work in `onInvocationEnd`, and await that
  work inside the hook. Do not assume all earlier hook work completed: the
  drain can reach its deadline with work still pending.

Before calling `onInvocationEnd`, the SDK drains promises returned by earlier
operation hooks across all plugins until they settle or until 500 ms before
the invocation's deadline. It then calls `onInvocationEnd` and waits until it
settles or until 50 ms before the deadline. These bounds reserve time for
flushing and returning the Lambda response. Reaching a bound stops the wait;
it does not cancel the
underlying work or guarantee telemetry delivery. Pending work may never
complete after the runtime freezes. If the context reports no usable deadline,
both waits continue until the work settles.

`onInvocationStart` remains awaited before any operation, so invocation-wide
asynchronous setup can finish there. `wrapInvocation`, `wrapChildContextFn`,
and `wrapOperationAttemptFn` remain inline around the customer function. They
do not wait for asynchronous work started by an earlier operation hook. See
[the hook scheduling contract](../packages/aws-durable-execution-sdk-js/src/types/plugin.ts)
for the full lifecycle guarantees.

### Replace the v1 provider contract

Environment-loaded modules still export `durableExecutionPluginProvider`, but
the exported object now uses the same factory contract as explicit registration.

```typescript
// Core 2.x
export const durableExecutionPluginProvider = {
  pluginApiVersion: 1,
  pluginType: AuditPlugin,
  createPlugin: () => new AuditPlugin(),
};
```

```typescript
// Core 3.0, alongside AuditPlugin and its imports above
export const durableExecutionPluginProvider: DurableInstrumentationPluginFactory = {
  createPlugin(info) {
    return new AuditPlugin(info.executionArn);
  },
};
```

Remove `pluginApiVersion` and `pluginType` after migrating construction and state
ownership. Declaring `pluginApiVersion` causes rejection on both explicit and
environment registration; the SDK does not reinterpret a v1 provider with a
different lifetime. Replace imports of `DurableInstrumentationPluginProvider`,
`DurableInstrumentationPluginType`, and
`DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION` with the appropriate factory type.

The `DURABLE_EXECUTION_PLUGINS` variable still selects package/module specifiers.
Preserve the provider export name and rebuild the package or layer containing
it. See [dynamic instrumentation plugins](../packages/aws-durable-execution-sdk-js/README.md#dynamic-instrumentation-plugins).

### Migrate OpenTelemetry registrations

Replace plugin constructors with factory builders. Existing `OtelPluginConfig`
options belong on the factory builder:

```typescript
// Core 2.x / OTel 1.x
import { InvocationOtelPlugin } from "@aws/durable-execution-sdk-js-otel";

const handler = withDurableExecution(myHandler, {
  plugins: [new InvocationOtelPlugin()],
});
```

```typescript
// Core 3.0 / OTel 2.0
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { createInvocationOtelPluginFactory } from "@aws/durable-execution-sdk-js-otel";

export const handler = withDurableExecution(
  async (_event, context) => context.step("work", async () => "ok"),
  { plugins: [createInvocationOtelPluginFactory()] },
);
```

Use `createExecutionOtelPluginFactory` for the execution-rooted view instead.
Register only one view across code and environment selection. The subpaths
`@aws/durable-execution-sdk-js-otel/otel-invocation` and
`@aws/durable-execution-sdk-js-otel/otel-execution` remain the environment-loading
entry points, but must resolve to OTel 2.

Shared providers remain outside invocation instances. `flushTimeoutMillis`
bounds the export wait; it does not guarantee delivery after timeout, export
failure, or runtime freezing. An invocation must not shut down a shared provider.
See the [OTel migration reference](../packages/aws-durable-execution-sdk-js-otel/README.md#migration-from-the-v1-provider-contract).

The execution view now reports `faas.max_memory` on the Invocation span in
bytes, as the OpenTelemetry semantic conventions define it. OTel 1.x reported
the Lambda memory setting in MiB. So a 1024 MiB function now reports
`1073741824` instead of `1024`. Update any query, dashboard or alarm that reads
this attribute.

### Move registration metadata to the factory

Use `RegisteredDurableInstrumentationPluginFactory` for custom exclusivity
metadata. `RegisteredDurableInstrumentationPluginType` is removed.
`RegisteredDurableInstrumentationPlugin` remains a type describing instance
metadata, but registration validates the factory's metadata in Core 3.
The symbol remains
`Symbol.for("aws.lambda.durable.instrumentation.plugin-registration")`; place its
`name` and optional `exclusiveGroup` metadata on the registered factory, not on
the returned plugin or its constructor. Configuration validates it before constructing plugins.
Inherited groups accumulate, so a wrapper must preserve its underlying view's
constraint rather than trying to hide it.

```typescript
// Core 3.0, alongside auditFactory above
import {
  DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION,
  type RegisteredDurableInstrumentationPluginFactory,
} from "@aws/durable-execution-sdk-js";

const registeredAuditFactory: RegisteredDurableInstrumentationPluginFactory = {
  ...auditFactory,
  [DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION]: {
    name: "example-audit",
    exclusiveGroup: "example-audit-view",
  },
};
// Pass registeredAuditFactory in plugins when this exclusivity rule is needed.
```

### Review behavior changes outside plugins

These changes apply with or without plugins:

- **Invoke failure causes.** A failed `context.invoke` still throws
  `InvokeError`. Its `cause.name` is now the invoked function's error type, for
  example `"PaymentError"`. In 2.x it was always `"Error"`. Update code that
  branches on `cause.name`.
- **Slow deserializers.** An operation now stays `EXECUTING` until its result is
  deserialized. So a deserializer that fails slowly now fails the invocation. In
  2.x the invocation could return `PENDING` and the failure was not reported. A
  deserializer that never settles now keeps the invocation open until the Lambda
  timeout.
- **Untracked awaits between operations.** The SDK suspends an idle invocation
  3 ms after the last operation goes idle. In 2.x it waited 20 ms. The SDK does
  not track an `await` in handler code between two durable operations, for
  example a dynamic `import()` or a file read. So when that `await` takes longer
  than 3 ms while another operation such as a callback is pending, the
  invocation can suspend before the next operation starts. The code after the
  `await` then runs again on the next invocation. Move that work into a `step`.

### Finding affected code

Search application code, providers, layer packaging, and tests:

```bash
rg -n 'plugins:|DURABLE_EXECUTION_PLUGINS|durableExecutionPluginProvider' .
rg -n 'pluginApiVersion|pluginType|DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION' .
rg -n 'DurableInstrumentationPluginProvider|RegisteredDurableInstrumentationPlugin|DurableInstrumentationPluginType' .
rg -n 'new (InvocationOtelPlugin|ExecutionOtelPlugin)|createPlugin' .
rg -n 'onOperation(Start|End|AttemptStart|AttemptEnd|Change)|onInvocation(Start|End)|wrap(Invocation|ChildContextFn|OperationAttemptFn)' .
rg -n '@aws/durable-execution-sdk-js|Layers:|layerVersionArn' .
rg -n 'cause\.name|faas\.max_memory' .
```

## Plugin state and invocation lifecycle

Keep invocation identity, spans, and operation buffers on the new plugin. Keep
intentionally shared providers/exporters outside it. One execution can suspend
and resume many times, creating a new plugin each time. Instance fields are not
checkpointed; reconstruct execution-wide state from invocation metadata and
checkpointed operations rather than assuming the last instance survives.

Do not use the presence of `OperationInfo.error` alone to detect failure. Error
details can be absent for failed operations; use `OperationInfo.status` and
`AttemptEndInfo.outcome` for their respective outcomes. This metadata correction
does not change persisted error payloads or operation identity.

If you copied the former Powertools logging example, update queries for the
adapter's `executionArn`, `requestId`, `operationId`, and `operationName` fields.
See the [logging guide](../packages/aws-durable-execution-sdk-js/README.md).

## Recommended validation after upgrading

1. Resolve the coordinated package versions, regenerate the lock file, and run
   your TypeScript build and tests. Verify the effective versions in any bundles
   and Lambda layers.
2. Exercise explicit and environment-selected providers. Confirm plugin output;
   a successful workflow does not prove a factory returned usable instrumentation.
3. Run a workflow that suspends and resumes. Verify a fresh plugin for each
   invocation, stable operation identity, and no repeated completed-step side
   effects. Keep operation names, order, nesting, and serialization compatible
   while executions are in flight.
4. Exercise concurrent invocations and `map` or `parallel`. Confirm spans,
   buffers, and execution identities stay with their own invocation.
5. Test success, failure, retry, and callbacks without error details. Check
   cleanup, status-based error handling, and telemetry for each outcome.
6. With OTel, verify the chosen view and log correlation after resume and under
   concurrency. With the Testing SDK, review assertions about invocation counts
   and history ordering against its corrected clock and notification behavior
   in the [release notes](../release-notes/sdk-3.0.0.md).
7. Delay custom operation-hook work and verify that wrappers see synchronously
   initialized state while operations continue. Check any explicit queue's
   ordering and recovery after a rejection. Test near-deadline invocation end
   with a hook that never settles: `onInvocationEnd` should still run, tolerate
   incomplete hook work, and allow the response to return within its time budget.
8. Run a workflow with a pending callback and a slow custom deserializer.
   Confirm that the next step runs in the same invocation. Check handler code for
   `await`s between durable operations that can take longer than 3 ms, and move
   that work into a step.
