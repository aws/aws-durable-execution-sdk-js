# Durable Execution SDK — Instrumentation Plugin Spec

## Introduction

Observability is a first-class concern for long-running workflows. A durable execution can span many Lambda invocations over hours, days, or months — making distributed tracing, metrics, and operational summaries essential for understanding what happened and diagnosing failures.

### Why Not Build OTel Support Directly Into the SDK?

- **Dependency bloat.** The SDK is bundled into every Lambda deployment package. Adding `@opentelemetry/api` increases bundle size for all users, including those who don't use OTel.
- **Library stability.** OTel's API and semantic conventions continue to evolve. Coupling the SDK to a specific OTel version creates upgrade friction.
- **Not everyone uses OTel.** Teams may use Datadog, AWS X-Ray, custom metrics pipelines, or no tracing at all.

### The Plugin Model

Instead of implementing observability directly, the SDK exposes a lightweight instrumentation plugin interface. Plugins are:

- **Optional** — zero cost if unused, no dependencies added to the bundle
- **Composable** — multiple plugins can be registered and all receive every hook call
- **General-purpose** — the same interface supports tracing, metrics, cost tracking, execution summaries, audit logs, or anything else

---

## Lifecycle Model

```
withDurableExecution(handler)
│
└── Lambda invocation 1  (first invocation)
│   ├── onExecutionStart(...)        ← once, only on first invocation
│   ├── onInvocationStart(...)
│   │   ├── onInvocation(...)
│   │   │   ├── onOperationStart(...)
│   │   │   │   ├── onOperationAttemptStart(...)
│   │   │   │   │   ├── wrapOperationAttempt(...)
│   │   │   │   └── onOperationAttemptEnd(...)   outcome: 'retrying' → retry timer, then next attempt
│   │   │   │   ├── onOperationAttemptStart(...)
│   │   │   │   │   ├── wrapOperationAttempt(...)
│   │   │   │   └── onOperationAttemptEnd(...)   outcome: 'succeeded' | 'failed'
│   │   │   ├── onOperationEnd(...)
│   │   │   ├── onOperationStart(...)
│   │   │   │   ├── wrapOperation(...)
│   │   │   ├── onOperationEnd(...)
│   └── onInvocationEnd(...)         ← Lambda is about to freeze or return
│
└── Lambda invocation N  (execution completes)
    ├── onInvocationStart(...)
    ├── ...
    ├── onInvocationEnd(...)
    └── onExecutionEnd(...)           ← durable execution reached terminal state
```

**Key distinctions:**

- An **operation** is the logical unit (one step = one operation, regardless of retries)
- An **attempt** is one execution of the operation's function body
- `onOperationStart/End` bracket the full lifetime of the operation across all attempts
- `onOperationAttemptStart/End` bracket each individual attempt
- `onInvocationEnd` is the correct place for flushing spans/metrics before Lambda freezes
- wrapOperation and wrapOperationAttempt are currently not used together. wrapOperation is currently only used to wrap operations executing code which don't have an attempt concept (run-in-child-context). wrapOperationAttempt does the same for operations which have built in retry attempts such as steps and wait-for-condition.

---

## Interface

```typescript
export interface OperationInfo {
  /** Matches Operation.Id (hashed) */
  Id: string;
  /** Matches Operation.Name */
  Name?: string;
  /** Matches Operation.Type */
  Type: string;
  /** Matches Operation.SubType */
  SubType?: string;
  /** Matches Operation.ParentId (hashed) */
  ParentId?: string;
  /** Matches Operation.StartTimestamp — available if operation was previously checkpointed */
  StartTimestamp?: Date;
}

export interface AttemptInfo extends OperationInfo {
  /** Matches Operation.StepDetails.Attempt */
  Attempt: number;
}

export interface AttemptEndInfo extends AttemptInfo {
  outcome: "succeeded" | "failed" | "retrying";
  error?: Error;
  nextAttemptDelaySeconds?: number;
}

export interface InvocationInfo {
  requestId: string;
  executionArn: string;
}

export interface ExecutionEndInfo extends InvocationInfo {
  status: "SUCCEEDED" | "FAILED";
  executionResult?: unknown;
  executionError?: Error;
  executionInput: unknown;
  /**
   * Full execution state at the time the execution reached terminal status.
   * Keyed by hashed operation ID — same shape as GetDurableExecutionState Operations.
   */
  operations: Record<string, Operation>;
}

export interface OperationChangeInfo extends InvocationInfo {
  /**
   * Operations whose status changed in this checkpoint response (the delta).
   * Keyed by hashed operation ID. Uses OperationUpdate from CheckpointDurableExecution response.
   */
  updatedOperations: Record<string, OperationUpdate>;
  /**
   * Full current execution state after applying this checkpoint response.
   * Keyed by hashed operation ID — same shape as GetDurableExecutionState Operations.
   */
  operations: Record<string, Operation>;
}

export interface DurableInstrumentationPlugin {
  onExecutionStart?(info: InvocationInfo): void;
  onExecutionEnd?(info: ExecutionEndInfo): void;
  wrapInvocation?(info: InvocationInfo, fn: () => T): void;
  onInvocationStart?(info: InvocationInfo): void;
  onInvocationEnd?(info: InvocationInfo): void;
  wrapOperation?(info: OperationInfo, fn: () => T): void;
  onOperationStart?(info: OperationInfo): void;
  onOperationEnd?(info: OperationInfo & { error?: Error }): void;
  wrapOperationAttempt?(info: AttemptInfo, fn: () => T): void;
  onOperationAttemptStart?(info: AttemptInfo): void;
  onOperationAttemptEnd?(info: AttemptEndInfo): void;
  /**
   * Called after a checkpoint batch completes and the backend returns new state.
   * Only fires when at least one operation's status changed in the response.
   */
  onOperationChange?(info: OperationChangeInfo): void;
  enrichLogContext?(): Record<string, string | number | boolean> | undefined;
}
```

All methods are optional — a plugin only needs to implement the hooks it cares about.

---

## Registration — Multiple Plugins

```typescript
export const handler = withDurableExecution(myHandler, {
  plugins: [otelPlugin, metricsPlugin],
});
```

Internally the SDK fans out to all plugins:

```typescript
export function createPluginRunner(
  plugins: DurableInstrumentationPlugin[],
): DurableInstrumentationPlugin {
  const run = <K extends keyof DurableInstrumentationPlugin>(
    method: K,
    info: Parameters<NonNullable<DurableInstrumentationPlugin[K]>>[0],
  ) => plugins.forEach((p) => (p[method] as any)?.(info));

    const runAsCallback = <K extends keyof DurableInstrumentationPlugin>(
        method: K,
        info: Parameters<NonNullable<DurableInstrumentationPlugin[K]>>[0],
        fn: () => any,
      ) => {
        const chain = plugins.reduceRight(
          (next, plugin) => () => {
            try {
              const hookFn = plugin[method] as any;
              if (hookFn) {
                return hookFn.call(plugin, info, next);
              }
              return next();
            } catch {
              return next();
            }
          },
          fn,
        );

  return {
    onExecutionStart: (info) => run("onExecutionStart", info),
    onExecutionEnd: (info) => run("onExecutionEnd", info),
    wrapInvocation: (info, fn) => runAsCallback("onInvocation", info, fn),
    onInvocationStart: (info) => run("onInvocationStart", info),
    onInvocationEnd: (info) => run("onInvocationEnd", info),
    wrapOperation: (info, fn) => runAsCallback("onOperation", info, fn),
    onOperationStart: (info) => run("onOperationStart", info),
    onOperationEnd: (info) => run("onOperationEnd", info),
    wrapOperationAttempt: (info, fn) => runAsCallback("onOperationAttempt", info, fn),
    onOperationAttemptStart: (info) => run("onOperationAttemptStart", info),
    onOperationAttemptEnd: (info) => run("onOperationAttemptEnd", info),
    onOperationChange: (info) => run("onOperationChange", info),
    enrichLogContext: () =>
      plugins.reduce((acc, p) => ({ ...acc, ...p.enrichLogContext?.() }), {}),
  };
}
```

---

## Sampling

The SDK exports a helper so plugins don't need to implement the hash themselves:

```typescript
export function shouldSampleExecution(
  executionArn: string,
  samplingRate: number, // 0.0 to 1.0
): boolean {
  if (samplingRate >= 1.0) return true;
  if (samplingRate <= 0.0) return false;
  let hash = 0x811c9dc5;
  for (let i = 0; i < executionArn.length; i++) {
    hash ^= executionArn.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash / 0xffffffff < samplingRate;
}
```

Usage in a plugin:

```typescript
class OtelPlugin implements DurableInstrumentationPlugin {
  constructor(private readonly samplingRate = 1.0) {}
  private sampled: boolean | undefined;

  onExecutionStart(info: InvocationInfo) {
    this.sampled = shouldSampleExecution(info.executionArn, this.samplingRate);
  }

  onOperationAttemptStart(info: AttemptInfo) {
    if (!this.sampled) return;
    // create span
  }
}
```

---

## Where Hooks Fire

### `with-durable-execution.ts`

```
Lambda invocation entry
├── plugins.onExecutionStart(...)     ← only on first invocation
├── plugins.onInvocationStart(...)
├── try {
│     plugins.wrapInvocation(runHandler(...))
│     on terminal result → plugins.onExecutionEnd(...)
│   } finally {
└──   plugins.onInvocationEnd(...)    ← always, even on freeze
    }
```

### Inside each handler

```
step-handler / wait-for-condition-handler
├── plugins.onOperationStart(...)
│   ├── plugins.onOperationAttemptStart(...)
│   ├── plugins.wrapOperationAttempt(...)
│   └── plugins.onOperationAttemptEnd(...)  outcome: 'succeeded' | 'failed' | 'retrying'
└── plugins.onOperationEnd(...)
```

```
wait-handler / invoke-handler / run-in-child-context-handler
├── plugins.onOperationStart(...)
│   ├── plugins.wrapOperation(...)
└── plugins.onOperationEnd(...)
```
