# Workflow Insight: End-to-End Design Document

## Overview

Workflow Insight is an observability system for AWS Lambda Durable Executions that captures execution state into customer-owned storage and provides a rich query UI powered by natural language (Amazon Bedrock). It consists of three components:

1. **Instrumentation Plugin** — captures execution lifecycle data from the Durable Execution SDK
2. **Storage Layer** — customer-owned Aurora Serverless v2 (PostgreSQL) accessed via RDS Data API
3. **Workflow Insight UI** — a React web application with structured filters and AI-powered natural language queries

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AWS Account (Customer-Owned)                  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │              Durable Lambda Function                      │       │
│  │                                                           │       │
│  │  ┌─────────────┐    ┌──────────────────────────────┐    │       │
│  │  │  Handler    │    │  Durable Execution SDK        │    │       │
│  │  │  (business  │◀──▶│  - step(), wait(), parallel() │    │       │
│  │  │   logic)    │    │  - checkpoint management      │    │       │
│  │  └─────────────┘    │  - plugin hook invocation     │    │       │
│  │                      └──────────────┬───────────────┘    │       │
│  │                                     │                     │       │
│  │                      ┌──────────────▼───────────────┐    │       │
│  │                      │  AuroraOperationsPlugin       │    │       │
│  │                      │  - onExecutionStart()         │    │       │
│  │                      │  - onOperationChange()        │    │       │
│  │                      │  - onExecutionEnd()           │    │       │
│  │                      └──────────────┬───────────────┘    │       │
│  └─────────────────────────────────────┼───────────────────┘       │
│                                        │ RDS Data API               │
│                                        ▼                            │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │           Aurora Serverless v2 (PostgreSQL)               │       │
│  │                                                           │       │
│  │  Table: durable_executions                                │       │
│  │  ┌─────────────────────────────────────────────────────┐ │       │
│  │  │ execution_arn | execution_name | status | input     │ │       │
│  │  │ output | operations (JSONB) | start_time | end_time │ │       │
│  │  └─────────────────────────────────────────────────────┘ │       │
│  └─────────────────────────────────────────────────────────┘       │
│                                        ▲                            │
│                                        │ RDS Data API               │
└────────────────────────────────────────┼────────────────────────────┘
                                         │
┌────────────────────────────────────────┼────────────────────────────┐
│              Workflow Insight UI (Local / Hosted)                     │
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────────┐     │
│  │  Vite React  │◀──▶│  Express API │───▶│  Amazon Bedrock   │     │
│  │  (Cloudscape)│    │  Server      │    │  (Claude Sonnet)  │     │
│  │              │    │              │───▶│                   │     │
│  │  - Filter    │    │  /api/       │    └───────────────────┘     │
│  │    Mode      │    │  executions  │                               │
│  │  - Chat Mode │    │  /api/chat/  │                               │
│  │  - Charts    │    │  generate    │                               │
│  │  - Export    │    │  /api/chat/  │                               │
│  └──────────────┘    │  execute     │                               │
│                      └──────────────┘                               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Component 1: Instrumentation Plugin

### Plugin Interface

The plugin implements the `DurableInstrumentationPlugin` interface from the SDK:

```typescript
interface DurableInstrumentationPlugin {
  onExecutionStart?(info: InvocationInfo): void;
  onExecutionEnd?(info: ExecutionEndInfo): void;
  onOperationChange?(info: OperationChangeInfo): void;
  onInvocationStart?(info: InvocationInfo): void;
  onInvocationEnd?(info: InvocationInfo): void;
}
```

### Lifecycle Hooks

| Hook                | When Fired                                        | What We Store                                                                      |
| ------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `onExecutionStart`  | First invocation of a new execution               | Creates row with `execution_arn`, `execution_name`, `status=STARTED`, `start_time` |
| `onOperationChange` | After each step/wait/parallel completes or starts | Updates `operations` JSONB with latest operation state                             |
| `onExecutionEnd`    | Execution completes (success or failure)          | Updates `status`, `input`, `output`, `end_time`                                    |

### Fire-and-Forget Design

Plugin hooks are **synchronous** (return `void`, not `Promise<void>`). The plugin internally fires async database writes without blocking the execution. This ensures:

- Zero latency impact on the workflow hot path
- Execution never fails due to observability errors
- Aligns with SDK's plugin runner that catches and logs plugin errors

### Registration

```typescript
const plugin = new AuroraOperationsPlugin(
  process.env.CLUSTER_ARN,
  process.env.SECRET_ARN,
  process.env.DB_NAME,
);

export const handler = withDurableExecution(myHandler, { plugins: [plugin] });
```

---

## Component 2: Storage Schema

### Table Design: One Row Per Execution

```sql
CREATE TABLE durable_executions (
  execution_arn  TEXT PRIMARY KEY,
  execution_name TEXT,
  status         TEXT,           -- STARTED | SUCCEEDED | FAILED
  input          JSONB,         -- Full execution input payload
  output         JSONB,         -- Execution result or error
  operations     JSONB,         -- Map of operation_id → operation details
  start_time     TIMESTAMPTZ,
  end_time       TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ DEFAULT now()
);
```

### Why One Row Per Execution

- **Fewer writes** — update one row vs. inserting N rows per operation
- **Simpler queries** — no JOINs needed for cross-execution analytics
- **JSONB flexibility** — operations stored as a map, queryable with PostgreSQL JSON operators
- **Atomic state** — single row always represents complete execution state

### Operations JSONB Structure

```json
{
  "c4ca4238a0b92382": {
    "id": "c4ca4238a0b92382",
    "name": "validate-order",
    "type": "STEP",
    "subType": "Step",
    "status": "SUCCEEDED",
    "startTime": "2026-04-13T01:09:22.846Z",
    "endTime": "2026-04-13T01:09:22.846Z",
    "duration": 0,
    "attempts": 1
  },
  "c81e728d9d4c2f63": {
    "id": "c81e728d9d4c2f63",
    "name": "",
    "type": "WAIT",
    "subType": "Wait",
    "status": "STARTED",
    "startTime": "2026-04-13T01:09:22.900Z",
    "duration": null,
    "attempts": 1
  }
}
```

### Query Patterns Supported

```sql
-- All failed executions in the last hour
SELECT * FROM durable_executions
WHERE status = 'FAILED' AND start_time > now() - interval '1 hour';

-- Executions by customer
SELECT * FROM durable_executions
WHERE input->>'customerId' = 'alice';

-- Operations with duration > 1 second
SELECT * FROM durable_executions
WHERE EXISTS (
  SELECT 1 FROM jsonb_each(operations) AS op
  WHERE op.value->>'name' = 'charge-customer'
    AND (op.value->>'duration')::int > 1000
);

-- Aggregation by product
SELECT input->>'product' as product, COUNT(*) as count
FROM durable_executions
GROUP BY input->>'product';
```

---

## Component 3: Workflow Insight UI

### Two Query Modes

#### Filter Mode (Structured)

Users build queries using form controls:

- **Date range picker** — absolute or relative time ranges
- **Execution filters** — status, duration, customer, product, amount, warehouse
- **Operation filters** — operation name + field (duration, status, attempts, type) + operator + value

Filters are applied client-side after fetching data from Aurora. Operation-level filters match against the same operation (e.g., "fulfill-order duration > 10s" checks that the same operation has both that name and that duration).

#### Chat Mode (Natural Language)

Users describe what they want in English. The system:

1. **Generates SQL** — Sends the question to Amazon Bedrock (Claude Sonnet) with a system prompt containing the full table schema, example queries, and output format rules
2. **Executes SQL** — Runs the generated query against Aurora via RDS Data API
3. **Retries on failure** — If the query fails, feeds the error back to Bedrock for self-correction (up to 3 attempts)
4. **Renders results** — Displays in the appropriate visualization based on Bedrock's `displayMode` response

### Bedrock Integration

The system prompt provides Bedrock with:

- Complete table schema with column types
- JSONB query examples for input/output/operations fields
- Available display modes and when to use each
- Chart options (scale, colorful, yDomain, title)
- Rules for consistent output format

Bedrock returns a JSON object:

```json
{
  "sql": "SELECT ...",
  "displayMode": "bar",
  "chartOptions": { "colorful": true, "yDomain": "auto" },
  "title": "Executions by Product"
}
```

### Visualization Types

| Display Mode  | Use Case                              | Library                     |
| ------------- | ------------------------------------- | --------------------------- |
| `table`       | List of executions or generic results | Cloudscape Table            |
| `bar`         | Comparisons, counts by category       | Recharts BarChart           |
| `line`        | Time series, trends                   | Recharts LineChart          |
| `pie`         | Proportions, distributions            | Recharts PieChart           |
| `calendar`    | Density over days (heatmap)           | Nivo Calendar               |
| `heatmap`     | 2D categorical data                   | Nivo HeatMap                |
| `stacked-bar` | Part-to-whole by category             | Recharts BarChart (stacked) |
| `grouped-bar` | Side-by-side comparison               | Recharts BarChart (grouped) |
| `bubble`      | 3D data (x, y, size)                  | Recharts ScatterChart       |

Combined modes (e.g., `bar+table`) show both chart and table simultaneously.

### Multi-Series Support

When a query returns multiple numeric columns (e.g., `min_amount`, `max_amount`), bar and line charts automatically render each as a separate colored series with legend entries.

### Drill-Down

Clicking a bar or pie slice triggers a drill-down query:

- The clicked value and its column name are captured
- A follow-up question is generated: "From the previous query, drill down into {column} = '{value}'"
- Bedrock generates a more detailed query with the appropriate WHERE clause

### Export

Results can be exported as:

- **CSV** — tabular data download
- **JSON** — structured data download
- **SVG** — vector chart image
- **PNG** — raster chart image (2x resolution, white background)

### Chat History

- Stored in `localStorage` (persists across sessions)
- Capped at 50 entries
- Each entry stores: question, SQL, title (LLM-generated), date, displayMode
- **Run** button re-executes saved SQL directly (skips LLM call)
- Deduplication: re-running the same question updates the existing entry

---

## Infrastructure (CDK Stack)

```typescript
// Aurora Serverless v2 — accessed via Data API (no VPC needed for clients)
const cluster = new rds.DatabaseCluster(this, "Cluster", {
  engine: rds.DatabaseClusterEngine.auroraPostgres({ version: "16.13" }),
  serverlessV2MinCapacity: 0.5,
  serverlessV2MaxCapacity: 4,
  enableDataApi: true,
});

// Durable Lambda — NOT in VPC, reaches Aurora via Data API
const fn = new NodejsFunction(this, "DurableHandler", { ... });
cfnFn.addPropertyOverride("DurableConfig", {
  ExecutionTimeout: 3600,
  RetentionPeriodInDays: 7,
});
```

### Key Design Decisions

| Decision            | Rationale                                                  |
| ------------------- | ---------------------------------------------------------- |
| Lambda NOT in VPC   | Avoids ENI cold starts, uses Data API (HTTPS) instead      |
| Aurora Data API     | No connection pooling needed, works from anywhere with IAM |
| `$LATEST` qualifier | Enables rapid prototyping without publishing versions      |

---

## Data Flow: End-to-End

### Write Path (Execution → Aurora)

```
1. Durable function is invoked (by any trigger — API Gateway, EventBridge, SDK, etc.)
2. Durable execution starts:
   a. SDK calls plugin.onExecutionStart() → INSERT row (status=STARTED)
   b. Handler runs step("validate-order")
   c. SDK calls plugin.onOperationChange() → UPDATE operations JSONB
   d. Handler runs wait({seconds: 5}) → checkpoint, Lambda exits
   e. [5 seconds pass, Lambda re-invoked]
   f. SDK replays completed steps (no plugin calls for replayed ops)
   g. Handler runs step("charge-customer")
   h. SDK calls plugin.onOperationChange() → UPDATE operations JSONB
   i. Handler runs step("fulfill-order")
   j. SDK calls plugin.onOperationChange() → UPDATE operations JSONB
   k. Handler returns result
   l. SDK calls plugin.onExecutionEnd() → UPDATE status, input, output, end_time
3. Single row in Aurora now contains complete execution record
```

### Read Path (UI → Aurora)

```
Filter Mode:
1. User selects date range + adds filters
2. Frontend calls GET /api/executions?startDate=X&endDate=Y
3. Express server queries Aurora via RDS Data API
4. Results returned, client-side filters applied
5. Table rendered with selectable rows + detail modal

Chat Mode:
1. User types natural language question
2. Frontend calls POST /api/chat/generate with question
3. Express server sends question to Bedrock with schema context
4. Bedrock returns {sql, displayMode, chartOptions, title}
5. Frontend shows "Generating query..." → displays SQL
6. Frontend calls POST /api/chat/execute with SQL
7. Express server runs SQL against Aurora
8. If error: feeds error back to Bedrock for retry (up to 3x)
9. Results rendered as chart/table/calendar based on displayMode
10. Entry saved to localStorage history
```

---

## Security Model

| Concern             | Approach                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Aurora access       | Lambda execution role has `rds-data:ExecuteStatement` + `secretsmanager:GetSecretValue`  |
| UI → Aurora         | Express server uses default AWS credential chain (developer's `ada` credentials locally) |
| UI → Bedrock        | Same credential chain, `bedrock-runtime:InvokeModel` permission                          |
| Data ownership      | All data in customer's AWS account, customer's IAM controls access                       |
| No platform storage | We never store execution data — it goes directly to customer's Aurora                    |

---

## Cost Characteristics

| Component            | Cost Driver                                                 |
| -------------------- | ----------------------------------------------------------- |
| Aurora Serverless v2 | ACU-hours (scales to 0.5 min), storage per GB               |
| RDS Data API calls   | $0.35 per million requests                                  |
| Plugin writes        | 2-4 Data API calls per execution (start + operations + end) |
| Bedrock (Chat Mode)  | Per-token pricing for Claude Sonnet                         |
| Lambda (Durable)     | Standard Lambda pricing + durable execution pricing         |

For the demo (1 execution/minute): ~43,200 executions/month, ~130K Data API calls/month ≈ $0.05/month for Data API + minimal Aurora ACU cost.

---

## Demo: Sample Execution Generator

For testing and demonstration purposes, the CDK stack includes a sample execution generator that continuously creates durable executions with randomized input data. This is **not part of the Workflow Insight system itself** — it simply produces executions so there is data to observe.

### How It Works

Durable Lambda functions cannot be invoked directly with an unqualified ARN — they require a qualified ARN (version number or `$LATEST`). EventBridge rules invoke Lambda using unqualified ARNs, so they cannot trigger durable functions directly.

To work around this, we use a two-Lambda pattern:

```
EventBridge Rule (every 1 min) → Invoker Lambda → Durable Lambda (:$LATEST)
```

### Invoker Lambda

A lightweight Lambda that:

1. Generates random input (customer, product, amount) from predefined lists
2. Invokes the durable function using the AWS SDK with the qualified ARN (`:$LATEST`)
3. Uses `InvocationType: "Event"` (async) so it doesn't wait for completion

```typescript
const CUSTOMERS = ["alice", "bob", "carol", "dave", "eve"];
const PRODUCTS = ["laptop", "phone", "tablet", "headphones", "keyboard"];

export const handler = async () => {
  const payload = {
    orderId: `order-${Date.now()}`,
    customerId: CUSTOMERS[Math.floor(Math.random() * CUSTOMERS.length)],
    amount: Math.round(Math.random() * 1000 * 100) / 100,
    product: PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)],
  };
  await client.send(
    new InvokeCommand({
      FunctionName: process.env.FUNCTION_ARN, // includes :$LATEST
      InvocationType: "Event",
      Payload: JSON.stringify(payload),
    }),
  );
};
```

### CDK Configuration

```typescript
const invoker = new NodejsFunction(this, "Invoker", {
  entry: path.join(__dirname, "../src/invoker.ts"),
  environment: { FUNCTION_ARN: `${fn.functionArn}:$LATEST` },
});
fn.grantInvoke(invoker);

const rule = new events.Rule(this, "SchedulerRule", {
  schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
});
rule.addTarget(new targets.LambdaFunction(invoker));
```

### Sample Durable Function

The demo handler simulates an order processing workflow with intentional variability:

1. **validate-order** — validates input (always succeeds if amount > 0)
2. **wait 5 seconds** — simulates waiting for fraud check
3. **charge-customer** — 10% random failure rate (simulates payment declines)
4. **fulfill-order** — assigns random warehouse (WH-1 through WH-5)

This produces a mix of successful and failed executions with varied durations (5s normal, ~60s when charge-customer retries), making the data interesting to query and visualize.

---

## Limitations & Future Work

| Limitation                           | Mitigation / Future                                       |
| ------------------------------------ | --------------------------------------------------------- |
| Fire-and-forget writes may lose data | Add configurable retry/buffer (Goal 22)                   |
| No truncation for large payloads     | Add size limits per destination (Goal 12)                 |
| Hardcoded Aurora ARNs in UI server   | Move to environment config or SSM                         |
| No sampling configuration            | SDK has `shouldSampleExecution` — expose in plugin config |
| Single destination (Aurora)          | Build additional plugins (S3, CloudWatch, DynamoDB)       |
| No schema versioning                 | Add version column, migration tooling                     |
| No correlation with X-Ray            | Add trace ID to emitted records                           |
| Local-only UI                        | Deploy to S3 + CloudFront + API Gateway Lambda            |
