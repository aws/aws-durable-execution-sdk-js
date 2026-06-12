# Workflow Insight: Design Document

## Overview

Workflow Insight is an opt-in observability system for AWS Lambda Durable Executions. It captures curated execution state into customer-owned storage destinations and provides query capabilities through multiple access surfaces — the AWS Console, IDE extensions, and a customizable open-source UI.

The system is built on three pillars:

1. **Data Emission** — SDK plugins that capture and emit execution lifecycle data
2. **Destination Plugins** — pluggable adapters that deliver data to customer-chosen storage
3. **Workflow Insight UI** — query interfaces with structured filters and natural language support

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Customer's AWS Account                           │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │                   Durable Lambda Function                      │     │
│  │                                                                │     │
│  │  ┌───────────┐    ┌────────────────────────────────────┐     │     │
│  │  │  Handler  │◀──▶│  Durable Execution SDK              │     │     │
│  │  └───────────┘    │                                    │     │     │
│  │                    │  Plugin Runner                     │     │     │
│  │                    │  ┌──────────┐ ┌──────────┐ ┌───┐ │     │     │
│  │                    │  │Plugin A  │ │Plugin B  │ │...│ │     │     │
│  │                    │  └────┬─────┘ └────┬─────┘ └─┬─┘ │     │     │
│  │                    └───────┼────────────┼─────────┼───┘     │     │
│  └────────────────────────────┼────────────┼─────────┼─────────┘     │
│                               │            │         │               │
│                               ▼            ▼         ▼               │
│  ┌────────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │ CloudWatch Logs│  │    Aurora     │  │      S3      │            │
│  └────────────────┘  └──────────────┘  └──────────────┘            │
│  ┌────────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │   DynamoDB     │  │   Kinesis    │  │ EventBridge  │            │
│  └────────────────┘  └──────────────┘  └──────────────┘            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐
│  Third-party     │  │  Custom      │  │  Workflow Insight │
│  (Datadog, etc.) │  │  Webhook     │  │  UI              │
└──────────────────┘  └──────────────┘  └──────────────────┘
```

---

### Data Preparation & Emission Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Durable Execution SDK                               │
│                                                                             │
│  Execution lifecycle events:                                                │
│  onExecutionStart → onOperationChange → ... → onExecutionEnd                │
│                                                                             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          WorkflowInsight Plugin                               │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 1. Sampling Check                                                    │    │
│  │    hash(executionArn) < samplingRate? → if no, skip entirely         │    │
│  └──────────────────────────────────┬──────────────────────────────────┘    │
│                                     │ sampled in                             │
│                                     ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 2. Record Assembly                                                   │    │
│  │    - Collect: executionArn, status, timing, correlationIds           │    │
│  │    - Include input/output based on `fields` config                   │    │
│  │    - Attach customFields (from context.setCustomFields())            │    │
│  └──────────────────────────────────┬──────────────────────────────────┘    │
│                                     │                                        │
│                                     ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 3. Operation Filtering                                               │    │
│  │    For each operation:                                                │    │
│  │    - No name + skipUnnamed=true? → exclude                           │    │
│  │    - Check operations config map (or "*" default)                    │    │
│  │      → NONE: exclude                                                 │    │
│  │      → SUMMARY: include metadata only                                │    │
│  │      → FULL: include metadata + result                               │    │
│  └──────────────────────────────────┬──────────────────────────────────┘    │
│                                     │                                        │
│                                     ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 4. Truncation                                                        │    │
│  │    - Check total record size against maxPayloadSize                  │    │
│  │    - If over limit: truncate input → output → operation results      │    │
│  │    - Set truncated=true if any field was cut                         │    │
│  └──────────────────────────────────┬──────────────────────────────────┘    │
│                                     │                                        │
│                                     ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 5. Schema Versioning                                                 │    │
│  │    - Stamp schemaVersion: "1.0"                                      │    │
│  │    - Stamp emittedAt: ISO timestamp                                  │    │
│  └──────────────────────────────────┬──────────────────────────────────┘    │
│                                     │                                        │
│                                     ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 6. Delivery                                                          │    │
│  │    best-effort:      destination.write(record) — fire and forget     │    │
│  │    at-least-once:    buffer → retry with backoff → flush on end      │    │
│  └──────────────────────────────────┬──────────────────────────────────┘    │
│                                     │                                        │
└─────────────────────────────────────┼────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Destination.write(record)                            │
│                                                                              │
│  ┌────────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────┐  │
│  │ CloudWatch Logs│  │  Aurora   │  │    S3    │  │ DynamoDB │  │ HTTP  │  │
│  │                │  │          │  │          │  │          │  │       │  │
│  │ PutLogEvents   │  │ UPSERT   │  │ PutObject│  │ PutItem  │  │ POST  │  │
│  └────────────────┘  └──────────┘  └──────────┘  └──────────┘  └───────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Emission Layer

### Plugin Interface

The SDK exposes a `DurableInstrumentationPlugin` interface. Customers register one or more plugins at handler creation time. The SDK's plugin runner invokes all registered plugins at each lifecycle event.

```typescript
interface DurableInstrumentationPlugin {
  onExecutionStart?(info: InvocationInfo): void;
  onExecutionEnd?(info: ExecutionEndInfo): void;
  onOperationChange?(info: OperationChangeInfo): void;
  onInvocationStart?(info: InvocationInfo): void;
  onInvocationEnd?(info: InvocationInfo): void;
  onOperationStart?(info: OperationInfo): void;
  onOperationEnd?(info: OperationInfo & { error?: Error }): void;
  onOperationAttemptStart?(info: AttemptInfo): void;
  onOperationAttemptEnd?(info: AttemptEndInfo): void;
  enrichLogContext?(): Record<string, string | number | boolean> | undefined;
}
```

### Lifecycle Events

| Event                         | Trigger                                                     | Data Available                                                |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| `onExecutionStart`            | First invocation of a new execution                         | executionArn, requestId                                       |
| `onOperationChange`           | Operation status changes (new step started, step completed) | Updated operations map, all operations                        |
| `onExecutionEnd`              | Execution completes or fails                                | Status, executionInput, executionResult/Error, all operations |
| `onInvocationStart/End`       | Each Lambda invocation (including replays)                  | requestId, executionArn                                       |
| `onOperationStart/End`        | Individual operation lifecycle                              | Operation name, type, error                                   |
| `onOperationAttemptStart/End` | Each retry attempt                                          | Attempt number, outcome, delay                                |

### Replay Safety

The SDK guarantees that `onExecutionStart` fires only once per execution (on the first invocation). `onOperationChange` fires only for new progress — replayed operations do not trigger plugin hooks. This prevents duplicate records and ensures correct metrics.

### Error Isolation

The plugin runner wraps each hook invocation in a try-catch. A failing plugin never crashes the execution. Errors are logged but swallowed, ensuring observability failures don't impact business logic.

### Non-Blocking Execution

Plugin hooks are synchronous (`void` return type). Plugins that perform I/O (network calls to destinations) must handle async internally (fire-and-forget or background flush). The SDK awaits `onInvocationEnd` to allow plugins to flush pending writes before the Lambda invocation completes.

---

## Configuration

### Minimal Setup (One Line)

```typescript
import { WorkflowInsight } from "@aws/durable-execution-insight";
import { CloudWatchLogsDestination } from "@aws/durable-execution-insight/destinations";

export const handler = withDurableExecution(myHandler, {
  plugins: [
    new WorkflowInsight({ destination: new CloudWatchLogsDestination() }),
  ],
});
```

Uses sensible defaults: all fields included, no sampling, finished executions only, emit to the function's default log group.

### Full Configuration

```typescript
import { WorkflowInsight } from "@aws/durable-execution-insight";
import { AuroraDestination } from "@aws/durable-execution-insight/destinations";
import { S3Destination } from "@aws/durable-execution-insight/destinations";

export const handler = withDurableExecution(myHandler, {
  plugins: [
    new WorkflowInsight({
      destination: new AuroraDestination({
        clusterArn: process.env.CLUSTER_ARN,
        secretArn: process.env.SECRET_ARN,
        database: "operations",
      }),
      fields: ["input", "output", "operations", "customFields"],
      inProgressUpdates: true,
      samplingRate: 1.0,
      maxPayloadSize: 256_000,
      delivery: "at-least-once",
    }),
    // Second instance for archival with different config
    new WorkflowInsight({
      destination: new S3Destination({
        bucket: "my-executions-archive",
        prefix: "durable/",
      }),
      fields: ["input", "output"],
      samplingRate: 0.05,
      delivery: "best-effort",
    }),
  ],
});
```

### Configuration Options

| Option              | Description                                                                      | Default              |
| ------------------- | -------------------------------------------------------------------------------- | -------------------- |
| `destination`       | Where to send data (required). A `Destination` instance.                         | —                    |
| `fields`            | Which data to include: `input`, `output`, `operations`, `customFields`, `errors` | All                  |
| `samplingRate`      | 0.0–1.0, decided per execution at start                                          | 1.0 (all)            |
| `inProgressUpdates` | Emit on every operation change, not just execution end                           | `false`              |
| `maxPayloadSize`    | Truncation threshold in bytes (overrides destination default)                    | Destination-specific |
| `delivery`          | `"best-effort"` or `"at-least-once"`                                             | `"best-effort"`      |
| `customFields`      | Function returning key-value metadata to attach                                  | None                 |
| `skipUnnamed`       | Skip operations that have no name                                                | `true`               |
| `operations`        | Per-operation detail level configuration                                         | `{ "*": "summary" }` |
| `transformInput`    | Function to select/redact fields from execution input                            | Include all          |
| `transformOutput`   | Function to select/redact fields from execution output                           | Include all          |

### Input/Output Transform

By default, the full execution input and output are included in the emitted record (subject to truncation). Use `transformInput` and `transformOutput` to select specific fields, redact sensitive data, or reshape the payload:

```typescript
new WorkflowInsight({
  destination: new AuroraDestination({ ... }),
  transformInput: (input) => ({
    customerId: input.customerId,
    amount: input.amount,
    region: input.region,
    // Omit large/sensitive fields like `payload`, `creditCard`, etc.
  }),
  transformOutput: (output) => ({
    status: output.status,
    orderId: output.orderId,
    // Omit verbose result details
  }),
})
```

- Return an object to include only selected fields
- Return `null` or `undefined` to exclude input/output entirely
- The transform runs before truncation — reducing size here avoids truncation downstream
- If `transformInput`/`transformOutput` is not provided, the full value is included

### Operation Detail Levels

Each operation can be configured to one of three detail levels using `OperationDetail`:

```typescript
import { WorkflowInsight, OperationDetail } from "@aws/durable-execution-insight";

new WorkflowInsight({
  destination: new AuroraDestination({ ... }),
  skipUnnamed: true,
  operations: {
    "validate-order": OperationDetail.FULL,
    "charge-customer": OperationDetail.SUMMARY,
    "fulfill-order": OperationDetail.NONE,
    "*": OperationDetail.SUMMARY,
  },
})
```

```typescript
enum OperationDetail {
  /** Operation excluded from record entirely */
  NONE = "none",
  /** id, name, type, subType, status, startTime, endTime, durationMs, attempts, error */
  SUMMARY = "summary",
  /** Everything in SUMMARY + result (operation return value, subject to truncation) */
  FULL = "full",
}
```

- `skipUnnamed: true` (default) — operations without a name are excluded regardless of the `"*"` setting. This keeps records clean since unnamed operations (e.g., anonymous `wait()` calls) are typically infrastructure-level and not interesting for observability.
- `skipUnnamed: false` — unnamed operations follow the `"*"` rule like any other operation.

### Sampling

Sampling is decided deterministically at execution start using a hash of the execution ARN. If sampled in, all data for that execution is emitted (every hook fires). If sampled out, no hooks fire. This ensures complete records for sampled executions rather than fragmented partial data.

```typescript
function shouldSampleExecution(
  executionArn: string,
  samplingRate: number,
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

### Custom Fields

Customers attach business-relevant metadata from within their handler:

```typescript
export const handler = withDurableExecution(async (event, context) => {
  context.setCustomFields({
    customerId: event.customerId,
    region: event.region,
    orderType: event.type,
  });
  // ... workflow logic
});
```

Custom fields are included in the emitted record and become queryable dimensions.

---

## Destination Plugins

### Destination Interface

Each destination implements a simple `Destination` interface. The `WorkflowInsight` plugin handles lifecycle, sampling, field selection, and truncation — the destination only handles writing:

```typescript
interface Destination {
  /** Write a single execution record. Called by WorkflowInsight after processing. */
  write(record: ExecutionRecord): Promise<void>;

  /** Flush any buffered records. Called on invocation end. */
  flush?(): Promise<void>;

  /** Default max payload size for this destination (bytes). */
  defaultMaxPayloadSize?: number;
}
```

This separation means:

- `WorkflowInsight` owns: sampling, field filtering, truncation, schema versioning, custom fields, error isolation
- `Destination` owns: serialization, batching, network I/O, credentials, retry

### Built-in AWS Destinations

| Destination                       | Import                                        | Best For                                                   | Query Via                         |
| --------------------------------- | --------------------------------------------- | ---------------------------------------------------------- | --------------------------------- |
| `CloudWatchLogsDestination`       | `@aws/durable-execution-insight/destinations` | Zero-setup, existing monitoring                            | CloudWatch Log Insights           |
| `S3Destination`                   | `@aws/durable-execution-insight/destinations` | Cost-effective archival, batch analytics                   | Athena                            |
| `AuroraDestination`               | `@aws/durable-execution-insight/destinations` | Full SQL, complex filtering, aggregation                   | RDS Data API                      |
| `DynamoDBDestination`             | `@aws/durable-execution-insight/destinations` | Fast single-execution lookups, TTL retention               | DynamoDB queries                  |
| `KinesisDestination`              | `@aws/durable-execution-insight/destinations` | Real-time streaming, fan-out                               | Kinesis consumers                 |
| `EventBridgeDestination`          | `@aws/durable-execution-insight/destinations` | Event-driven reactions, routing                            | EventBridge rules                 |
| `OpenSearchServerlessDestination` | `@aws/durable-execution-insight/destinations` | Full-text search, Kibana dashboards, high-volume analytics | OpenSearch query DSL / Dashboards |

### Destination Characteristics

| Destination           | Update Support                 | Query Capability                    | Cost Model             | Latency  |
| --------------------- | ------------------------------ | ----------------------------------- | ---------------------- | -------- |
| CloudWatch Logs       | Append-only (filter to latest) | Log Insights (limited)              | Per ingestion GB       | Low      |
| S3                    | Overwrite object               | Athena (full SQL)                   | Per storage + query    | Medium   |
| Aurora                | Full UPSERT                    | Full SQL                            | ACU-hours + storage    | Low      |
| DynamoDB              | Full UPSERT                    | Key/index queries                   | Per RCU/WCU            | Low      |
| Kinesis               | Append-only                    | Consumer processing                 | Per shard-hour         | Very low |
| EventBridge           | N/A (event routing)            | N/A                                 | Per event              | Very low |
| OpenSearch Serverless | Full UPSERT (by doc ID)        | Full-text search, aggregations, DSL | Per OCU-hour + storage | Low      |

### Third-Party Destinations

Destinations can target any HTTPS endpoint directly — no intermediate AWS service required:

```typescript
import { WorkflowInsight } from "@aws/durable-execution-insight";
import { HttpDestination } from "@aws/durable-execution-insight/destinations";

new WorkflowInsight({
  destination: new HttpDestination({
    endpoint: "https://http-intake.logs.datadoghq.com/v1/input",
    headers: { "DD-API-KEY": process.env.DD_API_KEY },
    format: "json",
  }),
});
```

### Custom Destination Development

Third parties implement the `Destination` interface:

```typescript
import type {
  Destination,
  ExecutionRecord,
} from "@aws/durable-execution-insight";

export class MyCustomDestination implements Destination {
  private buffer: ExecutionRecord[] = [];

  async write(record: ExecutionRecord): Promise<void> {
    this.buffer.push(record);
    if (this.buffer.length >= 10) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    await sendToMySystem(this.buffer);
    this.buffer = [];
  }
}
```

Usage:

```typescript
new WorkflowInsight({
  destination: new MyCustomDestination({ ... }),
  samplingRate: 0.1,
})
```

---

## Data Schema

### Emitted Record Structure

Each execution produces one logical record (may be multiple physical records for append-only destinations):

```typescript
interface ExecutionRecord {
  // Identity
  executionArn: string;
  executionName: string;
  functionArn: string;
  version: string;

  // Status
  status: "STARTED" | "SUCCEEDED" | "FAILED";
  startTime: string; // ISO 8601
  endTime?: string; // ISO 8601
  durationMs?: number;

  // Payload (configurable)
  input?: unknown; // Truncated if exceeds maxPayloadSize
  output?: unknown; // Truncated if exceeds maxPayloadSize
  error?: { message: string; type: string; stack?: string };

  // Operations (configurable)
  operations?: Record<
    string,
    {
      id: string;
      name: string;
      type: string; // STEP | WAIT | PARALLEL | MAP | INVOKE | CALLBACK
      subType: string;
      status: string;
      startTime: string;
      endTime?: string;
      durationMs?: number;
      attempts: number;
      result?: unknown; // Operation output/return value (truncated if exceeds limit)
      error?: { message: string; type: string };
    }
  >;

  // Custom fields (customer-defined)
  customFields?: Record<string, string | number | boolean>;

  // Metadata
  schemaVersion: "1.0";
  emittedAt: string; // ISO 8601
  truncated?: boolean; // True if any field was truncated
  correlationIds?: {
    traceId?: string; // X-Ray trace ID
    requestId?: string; // Lambda request ID
  };
}
```

### Schema Versioning

The `schemaVersion` field enables forward-compatible evolution. New fields are additive only — existing fields are never renamed or removed. Customers' dashboards and queries remain stable across SDK upgrades.

### Size Limits & Truncation

Each destination plugin enforces size limits appropriate for its destination:

| Destination     | Default Limit | Truncation Behavior                    |
| --------------- | ------------- | -------------------------------------- |
| CloudWatch Logs | 256 KB        | Truncate input/output, then operations |
| DynamoDB        | 400 KB        | Truncate input/output, then operations |
| Aurora          | 1 MB          | Truncate input/output                  |
| S3              | 5 MB          | Truncate input/output                  |
| Kinesis         | 1 MB          | Truncate input/output, then operations |

When truncation occurs, `truncated: true` is set in the record so customers know data was cut.

---

## Workflow Insight UI

### Access Surfaces

1. **AWS Console** — integrated into Lambda console, works with supported AWS destinations using customer's IAM role
2. **AWS Toolkit for VS Code** — same functionality inside the IDE
3. **Open-source customizable web UI** — standalone React app, forkable, supports custom query adapters for any destination

### Query Modes

#### Structured Filters

Form-based query builder with:

- Date/time range picker (absolute and relative)
- Execution-level filters (status, duration, function name, custom fields)
- Operation-level filters (operation name, type, duration, attempts, status)
- Filters are composable with AND/OR logic

#### Natural Language Query

Powered by Amazon Bedrock (or customer's preferred LLM):

1. User describes what they want in English
2. System constructs the appropriate query for the customer's destination
3. Query executes against the destination using customer's IAM credentials
4. Results rendered in the appropriate visualization

The NL system includes:

- Schema-aware prompt with destination-specific query syntax
- Self-correction: if generated query fails, error is fed back for retry (up to 3 attempts)
- Display mode selection: LLM chooses best visualization (table, bar, line, pie, calendar, heatmap)
- Chart configuration: LLM extracts preferences (colors, scale, axis labels) from the question

### Query Adapters

For each destination, the UI includes a query adapter that knows how to:

- Construct queries in the destination's native language (SQL, Log Insights, DynamoDB expressions, Athena SQL)
- Execute queries using the customer's IAM credentials
- Parse results into a common format for rendering

| Destination           | Query Language         | Adapter                       |
| --------------------- | ---------------------- | ----------------------------- |
| Aurora / RDS          | PostgreSQL             | RDS Data API                  |
| S3 (via Athena)       | Athena SQL             | Athena StartQueryExecution    |
| CloudWatch Logs       | Log Insights           | StartQuery / GetQueryResults  |
| DynamoDB              | Query/Scan expressions | DynamoDB Query API            |
| OpenSearch Serverless | OpenSearch DSL / SQL   | OpenSearch API                |
| Custom                | Customer-implemented   | Open-source adapter interface |

### Visualization

| Type                | Use Case                         |
| ------------------- | -------------------------------- |
| Table               | Execution lists, generic results |
| Bar chart           | Comparisons, counts by category  |
| Line chart          | Time series, trends              |
| Pie chart           | Proportions, distributions       |
| Calendar heatmap    | Density over days                |
| Heatmap             | 2D categorical data              |
| Stacked/Grouped bar | Multi-dimensional comparisons    |
| Bubble chart        | 3D relationships                 |

### Export

- CSV / JSON data export
- SVG / PNG chart export

---

## Delivery Guarantees

### Best-Effort (Default)

- Fire-and-forget: emit and continue
- No retry on failure
- Zero latency impact on execution
- Suitable for: dashboards, trending, non-critical analytics

### At-Least-Once

- Buffer writes in memory
- Retry with exponential backoff on failure
- Flush on `onInvocationEnd` (before Lambda freezes)
- Drop after max retries (with metric)
- Suitable for: compliance, auditing, alerting

### Guarantees That Always Hold

- Execution never fails due to emission failure
- Execution never slows down due to emission (async/non-blocking)
- Destination unavailability is handled gracefully (drop + metric, never crash)

---

## Observability of the Emission Pipeline

Customers can enable CloudWatch Metrics to monitor plugin health:

| Metric              | Description                                        |
| ------------------- | -------------------------------------------------- |
| `RecordsEmitted`    | Count of successfully emitted records              |
| `RecordsDropped`    | Count of records that failed to emit after retries |
| `EmissionLatencyMs` | Time taken to emit a record                        |
| `DestinationErrors` | Count of destination write failures                |
| `RecordSizeBytes`   | Size of emitted records                            |
| `TruncationCount`   | Count of records that required truncation          |

Customers set CloudWatch Alarms on these metrics to detect emission pipeline issues.

---

## Security

| Concern                          | Approach                                                   |
| -------------------------------- | ---------------------------------------------------------- |
| Destination access (AWS)         | Lambda execution role IAM policies                         |
| Destination access (third-party) | Secrets Manager or environment variables                   |
| Data in transit                  | TLS enforced for all destinations                          |
| Data at rest                     | Customer's KMS keys where destination supports it          |
| UI → Destination                 | Customer's IAM role, queries run in their security context |
| UI → LLM (Bedrock)               | Customer's IAM role, no data stored by Bedrock             |
| Data ownership                   | All data in customer's account, we never store or proxy it |

---

## Configuration Lifecycle

- Configuration is tied to the function version (same as durable Lambda itself)
- Changes apply only to new executions started after deployment
- In-progress executions continue with their original configuration
- No mid-execution inconsistencies

---

## Retention

Operational data retention is independent of execution state retention:

- Execution state retention: controlled by `RetentionPeriodInDays` in DurableConfig
- Observability data retention: controlled by the destination (DynamoDB TTL, S3 lifecycle, CloudWatch retention policy, Aurora manual cleanup)

Customers configure retention per destination according to their compliance and cost requirements.

---

## Cost Model

| Component            | Cost Driver                        | Optimization                                       |
| -------------------- | ---------------------------------- | -------------------------------------------------- |
| Plugin execution     | Minimal CPU in Lambda              | Fire-and-forget, no latency impact                 |
| Destination writes   | Per-request pricing of destination | Sampling, batching, field selection                |
| Destination storage  | Per-GB of destination              | Sampling, truncation, retention policies           |
| Destination queries  | Per-query pricing of destination   | Efficient queries, LIMIT clauses                   |
| Bedrock (NL queries) | Per-token                          | Cache generated SQL in history, re-run without LLM |

### Cost Estimation Example

For 100K executions/day, 5 operations/execution, all fields, Aurora destination:

- Writes: ~300K Data API calls/day × $0.35/million = ~$0.10/day
- Storage: ~100 bytes/execution × 100K = ~10 MB/day, negligible
- Queries: depends on usage, typically < $0.01/day

With 5% sampling: costs reduce by ~20x.

---

## Testability

### Local Development

`WorkflowInsight` works in local testing environments via the testing SDK:

```typescript
import { WorkflowInsight } from "@aws/durable-execution-insight";
import { ConsoleDestination } from "@aws/durable-execution-insight/destinations";
import { createTestDurableContext } from "@aws/durable-execution-sdk-js-testing";

// Prints formatted records to stdout
const plugin = new WorkflowInsight({ destination: new ConsoleDestination() });
const context = createTestDurableContext({ plugins: [plugin] });
```

### Verifying Emission

Developers can inspect what data will be emitted before deploying:

- `ConsoleDestination` — prints formatted records to stdout
- `MemoryDestination` — captures records in-memory for assertion in unit tests
- `DryRunDestination` — validates record format and size without sending anywhere

---
