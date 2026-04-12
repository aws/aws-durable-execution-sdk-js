# Metrics Plugin (`DurableMetricsPlugin`)

## Overview

The metrics plugin allows developers to emit custom metrics from durable executions based on configurable conditions. Rather than writing boilerplate metric emission code in every handler, developers declare what they care about and the plugin handles the rest.

The design is split into two layers to keep the core logic destination-agnostic:

- **`DurableMetricsPlugin`** (`@aws/durable-execution-sdk-js-metrics`) — evaluates conditions, batches triggered events, and delegates emission to a `MetricEmitter` function. No AWS SDK dependency.
- **Emitters** (e.g. `@aws/durable-execution-sdk-js-cloudwatch`) — thin adapters that translate `MetricEvent[]` to a specific backend (CloudWatch, Datadog, StatsD, etc.).

This plugin implements `DurableInstrumentationPlugin` and requires no OTel dependency.

---

## Use Cases

- Alert when a step fails more than N times
- Track executions whose total duration exceeds a threshold
- Count executions by outcome (succeeded/failed)
- Measure step latency for specific operations
- Detect executions with high retry rates

---

## Core Types (`@aws/durable-execution-sdk-js-metrics`)

```typescript
interface MetricEvent {
  name: string;
  value: number;
  unit?: string; // e.g. 'Count', 'Milliseconds'
  dimensions?: Record<string, string>;
}

type MetricEmitter = (metrics: MetricEvent[]) => Promise<void>;

interface MetricCondition {
  /** When to evaluate */
  on: "onOperationAttemptEnd" | "onOperationEnd" | "onExecutionEnd";
  /** Return true to emit the metric */
  condition: (
    info: AttemptEndInfo | OperationInfo | ExecutionEndInfo,
  ) => boolean;
  /** The metric to emit when condition is true */
  metric: (
    info: AttemptEndInfo | OperationInfo | ExecutionEndInfo,
  ) => MetricEvent;
}

interface DurableMetricsPluginConfig {
  conditions: MetricCondition[];
  emitter: MetricEmitter;
}
```

---

## Example Usage

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { DurableMetricsPlugin } from "@aws/durable-execution-sdk-js-metrics";
import { cloudWatchEmitter } from "@aws/durable-execution-sdk-js-cloudwatch";

export const handler = withDurableExecution(myHandler, {
  plugins: [
    new DurableMetricsPlugin({
      emitter: cloudWatchEmitter({ namespace: "MyApp/DurableExecutions" }),
      conditions: [
        // Emit a metric when any step is retried 3 or more times
        {
          on: "onOperationAttemptEnd",
          condition: (info) =>
            (info as AttemptEndInfo).outcome === "retrying" &&
            (info as AttemptEndInfo).attempt >= 3,
          metric: (info) => ({
            name: "StepHighRetryCount",
            value: 1,
            dimensions: {
              OperationName: info.operationName ?? info.operationType,
            },
          }),
        },

        // Emit step duration when it exceeds 5 seconds
        {
          on: "onOperationEnd",
          condition: (info) => {
            const start = info.attributes?.startTimestampMs as
              | number
              | undefined;
            return start != null && Date.now() - start > 5000;
          },
          metric: (info) => ({
            name: "SlowStepDuration",
            value: Date.now() - (info.attributes?.startTimestampMs as number),
            unit: "Milliseconds",
            dimensions: {
              OperationName: info.operationName ?? info.operationType,
            },
          }),
        },

        // Count failed executions
        {
          on: "onExecutionEnd",
          condition: (info) => (info as ExecutionEndInfo).status === "FAILED",
          metric: () => ({ name: "ExecutionFailed", value: 1 }),
        },

        // Emit total execution duration for all completed executions
        {
          on: "onExecutionEnd",
          condition: () => true,
          metric: (info) => ({
            name: "ExecutionDuration",
            value: (info as ExecutionEndInfo).getSummary().durationMs,
            unit: "Milliseconds",
          }),
        },
      ],
    }),
  ],
});
```

---

## Implementation Sketch

### `DurableMetricsPlugin` (core)

```typescript
export class DurableMetricsPlugin implements DurableInstrumentationPlugin {
  private readonly conditions: MetricCondition[];
  private readonly emitter: MetricEmitter;
  private pending: MetricEvent[] = [];

  constructor(config: DurableMetricsPluginConfig) {
    this.conditions = config.conditions;
    this.emitter = config.emitter;
  }

  onOperationAttemptEnd(info: AttemptEndInfo) {
    this.evaluate("onOperationAttemptEnd", info);
  }
  onOperationEnd(info: OperationInfo & { error?: Error }) {
    this.evaluate("onOperationEnd", info);
  }
  onExecutionEnd(info: ExecutionEndInfo) {
    this.evaluate("onExecutionEnd", info);
  }

  onInvocationEnd() {
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0);
    this.emitter(batch).catch(() => {
      /* best-effort */
    });
  }

  private evaluate(hook: MetricCondition["on"], info: any) {
    for (const cond of this.conditions) {
      if (cond.on === hook && cond.condition(info)) {
        this.pending.push(cond.metric(info));
      }
    }
  }
}
```

### `cloudWatchEmitter` (CloudWatch adapter)

```typescript
// @aws/durable-execution-sdk-js-cloudwatch
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";

export function cloudWatchEmitter(config: {
  namespace: string;
  region?: string;
}): MetricEmitter {
  const client = new CloudWatchClient({ region: config.region });
  return async (metrics) => {
    await client.send(
      new PutMetricDataCommand({
        Namespace: config.namespace,
        MetricData: metrics.map((m) => ({
          MetricName: m.name,
          Value: m.value,
          Unit: (m.unit ?? "Count") as any,
          Dimensions: Object.entries(m.dimensions ?? {}).map(
            ([Name, Value]) => ({ Name, Value }),
          ),
        })),
      }),
    );
  };
}
```

### Custom emitter example (Datadog / any other backend)

```typescript
const datadogEmitter: MetricEmitter = async (metrics) => {
  for (const m of metrics) {
    dogstatsd.gauge(
      m.name,
      m.value,
      Object.entries(m.dimensions ?? {}).map(([k, v]) => `${k}:${v}`),
    );
  }
};
```

---

## Design Notes

**Destination-agnostic core:** `DurableMetricsPlugin` has no AWS SDK dependency. Swapping the emitter is the only change needed to target a different backend.

**Batching:** Triggered `MetricEvent`s are buffered during the invocation and flushed together in `onInvocationEnd`. CloudWatch accepts up to 1000 data points per `PutMetricData` call.

**Fire-and-forget:** Emitter failures are swallowed — metric emission must never affect execution.

**Sampling:** For correctness metrics (failures, retries) sampling is usually not appropriate. For latency/duration metrics, sampling may be acceptable.

**IAM (CloudWatch emitter):** The Lambda execution role needs `cloudwatch:PutMetricData` permission on the target namespace.

---

## Packages

| Package                                    | Contents                                                                        | Peer deps                       |
| ------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------- |
| `@aws/durable-execution-sdk-js-metrics`    | `DurableMetricsPlugin`, `MetricCondition`, `MetricEvent`, `MetricEmitter` types | `@aws/durable-execution-sdk-js` |
| `@aws/durable-execution-sdk-js-cloudwatch` | `cloudWatchEmitter`, `ExecutionSummaryPlugin` (sub-project 9)                   | `@aws-sdk/client-cloudwatch`    |
