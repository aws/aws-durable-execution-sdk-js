# Instrumentation plugins

## Dynamic Instrumentation Plugins

Instrumentation plugins can be selected at Lambda cold start without importing
them in the function artifact. Install a provider package in the function or a
Lambda layer, then set an ordered list of package or module specifiers:

```text
DURABLE_EXECUTION_PLUGINS=@example/durable-otel,@example/durable-audit/provider
```

The SDK imports each module once when `withDurableExecution(...)` initializes
the wrapped handler. An unset or blank variable preserves the existing
behavior. Plugins passed through `DurableExecutionConfig.plugins` run first in
their configured order; environment-selected plugins follow in the order listed
in `DURABLE_EXECUTION_PLUGINS`. Both sources are additive, including when they
create the same plugin type.

Provider modules export a factory named `durableExecutionPluginProvider`. A
factory is an object with a `createPlugin(info)` method; a bare function is not
one and is rejected. The SDK calls `createPlugin` once per invocation, with that
invocation's `InvocationInfo`, so the instance it returns serves exactly one
invocation:

```typescript
import type {
  DurableInstrumentationPlugin,
  DurableInstrumentationPluginFactory,
} from "@aws/durable-execution-sdk-js";

class AuditPlugin implements DurableInstrumentationPlugin {
  constructor(
    private readonly exporter: Exporter,
    private readonly executionArn: string,
  ) {}
  // Implement the lifecycle hooks needed by this plugin.
}

// Built once for the execution environment and shared by every instance.
const exporter = new Exporter();

export const durableExecutionPluginProvider: DurableInstrumentationPluginFactory<AuditPlugin> =
  {
    createPlugin: (info) => new AuditPlugin(exporter, info.executionArn),
  };
```

Because an instance is dropped when its invocation returns, a plugin never has
to key per-execution state by execution ARN, and two executions running
concurrently in one execution environment cannot observe each other's state.
State that belongs to the execution environment — an exporter, a tracer
provider, a scheduler — belongs outside the factory, as above.

The module specifier must be resolvable through normal application module
resolution or Node.js module paths. For a Lambda layer, package the provider and
its dependencies under `nodejs/node_modules`:

```text
plugin-layer.zip
`-- nodejs
    `-- node_modules
        `-- @example
            `-- durable-audit
```

Malformed configuration, missing modules or exports, a
`durableExecutionPluginProvider` without a `createPlugin` method, and an entry in
`DurableExecutionConfig.plugins` without one are reported as `PluginLoadError`
failures before execution state is read — the two sources are checked by the same
rule, because an entry with no `createPlugin` could never produce a plugin. A
`createPlugin` that throws when it runs, or returns nothing, is contained like
any other plugin failure: that plugin sits out the invocation and the execution
is unaffected.

## Instrumentation Operation Status and Errors

Use `OperationInfo.status` to identify terminal operation states such as `FAILED`,
`CANCELLED`, `TIMED_OUT`, and `STOPPED`. `OperationInfo.error` contains optional
error details; a failed operation can have `error === undefined`, including in
replay and `onOperationChange` metadata. Missing or empty checkpointed error data
does not invent an error. Supplied partial details, including explicitly empty
strings or an empty stack trace, remain available.

This also applies to API-v1 plugins: code that uses only the presence of `error`
as its failure signal should inspect `status` instead. For an attempt-end hook,
use `AttemptEndInfo.outcome` to determine whether that attempt failed. An external
callback failure without error details still rejects the callback promise and
retains its failed operation status; optional instrumentation details do not
change the caller's outcome or persisted state.

## SDK 3.x plugin migration

See the [2.x to 3.0 migration guide](../../../../docs/migration-2.x-to-3.0.md) for
package versions, before/after examples, provider packaging, and validation.

SDK 3.x requires an explicit migration from the legacy v1 provider contract.
Providers declaring `pluginApiVersion` are rejected with `PluginLoadError` in
both `plugins` and `DURABLE_EXECUTION_PLUGINS` registration. They are not silently
called with a different lifetime: v1 `createPlugin()` ran once per handler,
whereas a 3.x factory's `createPlugin(info)` runs once per invocation.

Replace legacy provider/instance registrations with a factory object:

```typescript
import { withDurableExecution, type InvocationInfo } from "@aws/durable-execution-sdk-js";

const factory = {
  createPlugin(info: InvocationInfo) {
    return new MyPlugin(info);
  },
};
const handler = withDurableExecution(myHandler, { plugins: [factory] });
```

Return a fresh plugin instance for each invocation. Keep intentionally shared
resources, such as a tracer provider/exporter, outside the invocation instance;
keep invocation-specific spans, operation maps and buffers inside it. Remove
legacy `pluginApiVersion` and `pluginType` metadata after migrating the factory.
Environment-loaded modules still export `durableExecutionPluginProvider`, whose
value is now this factory shape. Upgrade bundled OTel layers together with core
3.x and use their factory builders; an old 1.x layer is rejected rather than
silently reinterpreted. Core 2.x's supported v1 providers are unaffected by this
major-only policy.
