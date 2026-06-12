# Workflow Insight Plugin — Contracts

## 1. Plugin Configuration Contract

```typescript
import { DurableInstrumentationPlugin } from "@aws/durable-execution-sdk-js";

/**
 * Exporter interface — any class that knows how to send a WorkflowInsightRecord
 * to a specific destination. Each exporter owns its own configuration.
 */
interface InsightExporter {
  /** Send (or upsert) a record to the destination. */
  export(record: WorkflowInsightRecord): Promise<void>;

  /** Optional: flush any buffered data. Called before Lambda returns. */
  flush?(): Promise<void>;

  /**
   * Maximum record size in bytes before truncation.
   * Each exporter can set its own limit based on destination constraints.
   * Default: 256KB. Truncation removes operation results starting from oldest.
   */
  maxRecordSizeBytes?: number;
}

interface WorkflowInsightConfig {
  /**
   * One or more exporters that receive curated execution records.
   * Each exporter handles its own destination-specific config.
   * At least one exporter is required.
   */
  exporters: InsightExporter[];

  /**
   * Sampling rate: 0.0 to 1.0.
   * Decision is made once per execution (all-or-nothing).
   * Default: 1.0 (emit all executions)
   */
  samplingRate?: number;

  /**
   * When to emit records.
   * - "finished-only": emit one record when execution ends (default)
   * - "in-progress": emit/update on every operation status change + end
   */
  emitMode?: "finished-only" | "in-progress";

  /**
   * Control what data is included in the emitted record.
   */
  content?: ContentConfig;
}

// --- Type Aliases ---

/** Any value that can appear in execution data after serialization. */
type JsonValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | Date
  | Buffer
  | Uint8Array
  | RegExp
  | Map<string, JsonValue>
  | Set<JsonValue>
  | JsonValue[]
  | { [key: string]: JsonValue };

/** The JSON payload provided as input to the durable execution. */
type ExecutionInput = JsonValue;

/** The JSON payload returned by the durable execution on success. */
type ExecutionOutput = JsonValue;

/** The JSON value returned by an operation (step, invoke, callback, etc.). */
type OperationResult = JsonValue;

interface OperationOverride {
  /** Operation name (from step("name", fn)). */
  operationName: string;

  /**
   * Exclude this operation from the record entirely.
   * Default: false.
   */
  exclude?: boolean;

  /**
   * Include and optionally transform the operation's result.
   * If omitted, result is not included (default behavior).
   * - (r) => r: include full result
   * - (r) => ({ field: r.field }): include only specific fields
   */
  result?: (result: OperationResult) => OperationResult;
}

// --- Content Configuration ---

interface ContentConfig {
  /**
   * Transform execution input before including in the record.
   * - true: include as-is (default)
   * - false: exclude entirely
   * - function: transform to whatever shape you want (redact, reshape, pick fields)
   */
  input?: boolean | ((input: ExecutionInput) => ExecutionInput);

  /**
   * Transform execution output before including in the record.
   * - true: include as-is (default)
   * - false: exclude entirely
   * - function: transform to whatever shape you want
   */
  output?: boolean | ((output: ExecutionOutput) => ExecutionOutput);

  /**
   * Control which operations are included and what detail level.
   *
   * Default: all named operations are included (status, timing, attempts, errors)
   * but WITHOUT their result field. Unnamed operations are excluded.
   *
   * Use overrides to include results for specific operations or exclude them entirely.
   */
  operations?: {
    /** Per-operation overrides. */
    overrides?: OperationOverride[];

    /** Include operation error details. Default: true. */
    includeErrors?: boolean;
  };
}
```

### First-Party Exporters (shipped by us)

```typescript
import {
  CloudWatchLogsExporter,
  S3Exporter,
  DynamoDBExporter,
  OTelExporter,
} from "@aws/durable-execution-sdk-js-insight";

// Each exporter owns its config — the plugin doesn't know about buckets or tables.

new CloudWatchLogsExporter({
  logGroupName?: string;   // default: Lambda function's own log group
  logStreamPrefix?: string; // default: "workflow-insight/"
})

new S3Exporter({
  bucket: string;
  prefix?: string;          // default: "workflow-insight/"
  partitioning?: "date" | "function-name" | "none"; // default: "date"
})

new DynamoDBExporter({
  tableName: string;
  partitionKey?: string;    // default: "pk", value = executionArn
})

new OTelExporter({
  endpoint: string;         // e.g., "http://localhost:4318/v1/logs"
  headers?: Record<string, string>;
  protocol?: "http/json" | "grpc"; // default: "http/json"
})
```

### Third-Party Exporters (published by vendors or community)

```typescript
// Published on npm by Datadog, Splunk, etc. — we don't maintain these.
import { DatadogExporter } from "@datadog/durable-execution-exporter";
import { SplunkExporter } from "@splunk/durable-execution-exporter";

new DatadogExporter({ apiKey: process.env.DD_API_KEY, site: "datadoghq.com" });
new SplunkExporter({ token: process.env.SPLUNK_HEC_TOKEN, url: "https://..." });
```

### Custom Exporters (built by customers)

```typescript
// Customers implement InsightExporter directly — no special "custom" type needed.
class MyCustomExporter implements InsightExporter {
  async export(record: WorkflowInsightRecord): Promise<void> {
    await fetch("https://my-service.example.com/ingest", {
      method: "POST",
      body: JSON.stringify(record),
    });
  }
}
```

### Usage Example

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import {
  workflowInsight,
  CloudWatchLogsExporter,
} from "@aws/durable-execution-sdk-js-insight";

const insight = workflowInsight({
  exporters: [new CloudWatchLogsExporter()],
  emitMode: "finished-only",
});

export const handler = withDurableExecution(myHandler, {
  plugins: [insight],
});
```

### Progressive Configuration

```typescript
// Minimum: one line
const insight = workflowInsight({
  exporters: [new CloudWatchLogsExporter()],
});

// With sampling
const insight = workflowInsight({
  exporters: [new CloudWatchLogsExporter()],
  samplingRate: 0.1, // 10% of executions
});

// Multi-exporter
const insight = workflowInsight({
  exporters: [
    new S3Exporter({ bucket: "my-insight-bucket" }),
    new OTelExporter({
      endpoint: "https://otlp.datadoghq.com/v1/logs",
      headers: { "DD-API-KEY": process.env.DD_API_KEY },
      maxRecordSizeBytes: 128_000,
    }),
  ],
  emitMode: "in-progress",
  content: {
    input: (input) => ({
      customerId: input.customerId,
      orderId: input.orderId,
    }),
    output: true,
    operations: {
      overrides: [
        {
          operationName: "charge-payment",
          result: (r) => ({ amount: r.amount, status: r.status }),
        },
        { operationName: "validate-order", result: (r) => r }, // full result
        { operationName: "internal-logging", exclude: true }, // exclude entirely
      ],
    },
  },
});

// Redact sensitive fields
const insight = workflowInsight({
  exporters: [new CloudWatchLogsExporter()],
  content: {
    input: (input) => ({ ...input, creditCard: undefined, ssn: undefined }),
    output: (output) => ({ orderId: output.orderId, status: output.status }),
  },
});

// Minimal: no input/output, no errors
const insight = workflowInsight({
  exporters: [new S3Exporter({ bucket: "my-bucket" })],
  content: {
    input: false,
    output: false,
    operations: { includeErrors: false },
  },
});
```

---

## 2. Emitted Record Contract (WorkflowInsightRecord)

This is the shape of the curated JSON record written to destinations.

```typescript
interface WorkflowInsightRecord {
  /** Schema version for forward compatibility. */
  schemaVersion: "1.0";

  /** ISO-8601 timestamp when this record was emitted. */
  emittedAt: string;

  // --- Execution Identity ---

  /** Full ARN: arn:aws:lambda:region:account:function:name:qualifier */
  executionArn: string;

  /** Customer-provided execution name (from --durable-execution-name), if any. */
  executionName?: string;

  /** Function name (without qualifier). */
  functionName: string;

  /** Function qualifier (version or alias). */
  functionQualifier: string;

  /** AWS region. */
  region: string;

  /** AWS account ID. */
  accountId: string;

  // --- Execution State ---

  /** Current execution status. */
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "PENDING";

  /** ISO-8601 timestamp when execution started. */
  startTime: string;

  /** ISO-8601 timestamp when execution ended (null if still running). */
  endTime?: string;

  /** Duration in milliseconds (null if still running). */
  durationMs?: number;

  // --- Input/Output ---

  /** Execution input (may be truncated if over size limit). */
  input?: unknown;

  /** Execution result on success (may be truncated). */
  output?: unknown;

  /** Error details on failure. */
  error?: {
    name: string;
    message: string;
  };

  // --- Operations ---

  /**
   * Array of operations in execution order.
   * Each operation represents a step, wait, invoke, callback, or child context.
   */
  operations: OperationRecord[];

  // --- Metadata ---

  /** Plugin version that emitted this record. */
  pluginVersion: string;

  /** SDK version. */
  sdkVersion: string;
}

interface OperationRecord {
  /** Hashed operation ID (stable across replays). */
  id: string;

  /** Customer-provided name (from step("name", fn)). */
  name?: string;

  /** STEP | WAIT | CALLBACK | CHAINED_INVOKE | CONTEXT */
  type: string;

  /** Additional categorization. */
  subType?: string;

  /** Parent operation ID if nested in a child context. */
  parentId?: string;

  /** STARTED | SUCCEEDED | FAILED | PENDING | CANCELLED | TIMED_OUT */
  status: string;

  /** ISO-8601 start time. */
  startTime?: string;

  /** ISO-8601 end time. */
  endTime?: string;

  /** Duration in milliseconds. */
  durationMs?: number;

  /** Number of attempts (for steps with retry). */
  attempt?: number;

  /** Error details if this operation failed. */
  error?: {
    name: string;
    message: string;
  };
}
```

### Example Emitted Record

```json
{
  "schemaVersion": "1.0",
  "emittedAt": "2026-06-10T21:30:00.000Z",
  "executionArn": "arn:aws:lambda:us-east-1:123456789012:function:order-processor:prod:exec-abc123",
  "executionName": "order-12345",
  "functionName": "order-processor",
  "functionQualifier": "prod",
  "region": "us-east-1",
  "accountId": "123456789012",
  "status": "FAILED",
  "startTime": "2026-06-10T21:29:55.000Z",
  "endTime": "2026-06-10T21:30:00.000Z",
  "durationMs": 5000,
  "input": { "orderId": "12345", "customerId": "cust-789" },
  "error": {
    "name": "TimeoutError",
    "message": "Stripe payment timed out after 3 retries"
  },
  "operations": [
    {
      "id": "e5f6a7b8",
      "name": "validate-order",
      "type": "STEP",
      "status": "SUCCEEDED",
      "startTime": "2026-06-10T21:29:55.100Z",
      "endTime": "2026-06-10T21:29:55.300Z",
      "durationMs": 200,
      "attempt": 1
    },
    {
      "id": "c9d0e1f2",
      "name": "check-inventory",
      "type": "STEP",
      "status": "SUCCEEDED",
      "startTime": "2026-06-10T21:29:55.300Z",
      "endTime": "2026-06-10T21:29:55.800Z",
      "durationMs": 500,
      "attempt": 1
    },
    {
      "id": "a1b2c3d4",
      "name": "charge-payment",
      "type": "STEP",
      "status": "FAILED",
      "startTime": "2026-06-10T21:29:55.800Z",
      "endTime": "2026-06-10T21:30:00.000Z",
      "durationMs": 4200,
      "attempt": 3,
      "error": {
        "name": "TimeoutError",
        "message": "Stripe payment timed out after 3 retries"
      }
    },
    {
      "id": "b3c4d5e6",
      "name": "send-notification",
      "type": "STEP",
      "status": "PENDING",
      "startTime": null,
      "endTime": null
    }
  ],
  "pluginVersion": "0.1.0",
  "sdkVersion": "2.0.0"
}
```

---

## 3. Emit Timing & Lifecycle

| emitMode        | When record is emitted                                        | Record updates?                                      |
| --------------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| `finished-only` | Once, at `onInvocationEnd` when status is SUCCEEDED or FAILED | No — single write                                    |
| `in-progress`   | On every `onOperationChange` + at `onInvocationEnd`           | Yes — same record key, overwritten with latest state |

### Critical constraint: `onInvocationEnd` must be awaited

The current plugin runner fires `onInvocationEnd` as fire-and-forget. For Workflow Insight, this is the moment we flush to the destination. If Lambda terminates before the write completes, data is lost.

**Proposed fix:** Use `wrapInvocation` instead (already awaited), or modify the plugin runner to await `onInvocationEnd` before returning the Lambda response.

---

## 4. What This Record Enables (Query Examples)

| Question                                       | Query against this record                                            |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| Which executions failed at the payment step?   | `WHERE status = 'FAILED' AND error.operationName = 'charge-payment'` |
| Average duration of successful executions?     | `AVG(durationMs) WHERE status = 'SUCCEEDED'`                         |
| Which step has the highest failure rate?       | Unnest operations, group by name, count failed/total                 |
| Executions with >3 retry attempts on any step? | `WHERE ANY(operations[*].attempt > 3)`                               |
| Currently running executions?                  | `WHERE status = 'RUNNING'` (in-progress mode only)                   |
