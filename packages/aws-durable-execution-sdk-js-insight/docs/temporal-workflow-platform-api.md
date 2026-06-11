# Temporal Workflow Platform - API & Query Capabilities

## Overview

Temporal is a durable execution platform with the most comprehensive workflow querying and management capabilities of any platform reviewed. It provides full SQL-like query language, 20+ default search attributes, custom search attributes, bulk operations, and access via CLI, gRPC API, TypeScript/Go/Java/Python/PHP/.NET SDKs, and Web UI.

## Database / Storage Technology

Temporal requires **two separate databases**:

### Persistence Store (Workflow State & History)

- **Cassandra** - Recommended for large-scale production
- **PostgreSQL** - Popular for smaller deployments
- **MySQL** - Alternative SQL option
- **SQLite** - Development/testing only

### Visibility Store (Search & Listing)

- **Elasticsearch** - Full advanced visibility, recommended for production
- **PostgreSQL** (v12+) - Advanced visibility since Server v1.20
- **MySQL** (v8.0.17+) - Advanced visibility since Server v1.20
- **SQLite** (v3.31.0+) - Development/testing only

### Temporal Cloud

- Fully managed infrastructure (no database management required)

**Note**: Custom search attributes require advanced visibility (Elasticsearch or SQL databases with Server v1.20+). Without advanced visibility, only basic `=` operator with a single default search attribute is supported.

## Execution Status Values (7)

| Status           | Description                                    |
| ---------------- | ---------------------------------------------- |
| `Running`        | Currently executing                            |
| `Completed`      | Finished successfully                          |
| `Failed`         | Terminated due to error                        |
| `Canceled`       | Gracefully canceled (workflow can run cleanup) |
| `Terminated`     | Force-stopped (no cleanup)                     |
| `ContinuedAsNew` | Restarted with new execution                   |
| `TimedOut`       | Exceeded timeout                               |

## CLI Commands (25+)

### Workflow Lifecycle

| Command                       | Description                              |
| ----------------------------- | ---------------------------------------- |
| `temporal workflow start`     | Start new workflow, return IDs           |
| `temporal workflow execute`   | Start + block until result               |
| `temporal workflow cancel`    | Graceful cancel (allows cleanup)         |
| `temporal workflow terminate` | Force stop (no cleanup)                  |
| `temporal workflow delete`    | Delete execution + event history         |
| `temporal workflow pause`     | Pause execution _(experimental)_         |
| `temporal workflow unpause`   | Resume paused execution _(experimental)_ |
| `temporal workflow reset`     | Reset to point in event history          |

### Querying & Observability

| Command                      | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| `temporal workflow list`     | List workflows with SQL-like filter            |
| `temporal workflow count`    | Count matching workflows                       |
| `temporal workflow describe` | Get workflow execution details                 |
| `temporal workflow show`     | Show full event history                        |
| `temporal workflow trace`    | Real-time execution trace with child workflows |
| `temporal workflow result`   | Wait for and return result                     |
| `temporal workflow metadata` | Get user-set summary/details                   |
| `temporal workflow stack`    | Get stack trace of running workflow            |
| `temporal workflow query`    | Query workflow internal state                  |

### Communication

| Command                               | Description                                                |
| ------------------------------------- | ---------------------------------------------------------- |
| `temporal workflow signal`            | Send async notification                                    |
| `temporal workflow signal-with-start` | Signal existing or start+signal                            |
| `temporal workflow update`            | Synchronous state mutation (execute/start/describe/result) |

### Bulk Operations (via --query flag)

| Command          | Supports Bulk                                                |
| ---------------- | ------------------------------------------------------------ |
| `cancel`         | ✅                                                           |
| `terminate`      | ✅                                                           |
| `delete`         | ✅                                                           |
| `signal`         | ✅                                                           |
| `update-options` | ✅                                                           |
| `reset`          | ✅ (limited to FirstWorkflowTask, LastWorkflowTask, BuildId) |

```bash
# Cancel all failed workflows of a specific type
temporal workflow cancel --query "WorkflowType = 'OrderWorkflow' AND ExecutionStatus = 'Failed'"

# Terminate all running workflows started before a date
temporal workflow terminate --query "ExecutionStatus = 'Running' AND StartTime < '2024-01-01T00:00:00Z'"

# Signal all running workflows matching criteria
temporal workflow signal --query "WorkflowType = 'BatchJob'" --name "shutdown" --input '"graceful"'
```

## List Filter Query Language (SQL-like)

### Supported Operators

| Operator                 | Description                         |
| ------------------------ | ----------------------------------- |
| `=`, `!=`                | Equality / inequality               |
| `>`, `>=`, `<`, `<=`     | Comparison                          |
| `AND`, `OR`, `()`        | Boolean logic with grouping         |
| `BETWEEN...AND`          | Range queries                       |
| `IN`                     | Set membership                      |
| `STARTS_WITH`            | Prefix matching (Keyword type only) |
| `IS NULL`, `IS NOT NULL` | Null checks                         |

**Note**: `ORDER BY` is supported on self-hosted but not on Temporal Cloud.

### Query Examples

```sql
-- By status
ExecutionStatus = 'Running'

-- By workflow type and status
WorkflowType = 'OrderWorkflow' AND ExecutionStatus != 'Running'

-- Complex time-based query
WorkflowType = 'main.YourWorkflow' AND ExecutionStatus != 'Running'
  AND (StartTime > '2024-06-07T16:46:34.236-08:00' OR CloseTime > '2024-06-07T16:46:34-08:00')

-- By time range
ExecutionTime BETWEEN '2024-01-01T00:00:00Z' AND '2024-01-31T00:00:00Z'

-- Multiple statuses
ExecutionStatus IN ('Failed', 'TimedOut', 'Canceled')

-- Prefix matching
WorkflowId STARTS_WITH 'order-'

-- Custom search attributes
WorkflowType = 'PaymentWorkflow' AND CustomerId = 'cust-123' AND Amount > 1000

-- By task queue
TaskQueue = 'high-priority-queue'

-- By worker build ID
BuildIds = 'versioned:v2.0'
```

## Default Search Attributes (20+)

| Name                                 | Type        | Description                                  |
| ------------------------------------ | ----------- | -------------------------------------------- |
| `WorkflowId`                         | Keyword     | Identifies the workflow execution            |
| `WorkflowType`                       | Keyword     | The type of workflow                         |
| `ExecutionStatus`                    | Keyword     | Current state (Running, Completed, etc.)     |
| `StartTime`                          | Datetime    | When execution started                       |
| `CloseTime`                          | Datetime    | When execution completed                     |
| `ExecutionTime`                      | Datetime    | Actual begin time (differs for cron/retry)   |
| `ExecutionDuration`                  | Int         | Duration in nanoseconds (closed only)        |
| `RunId`                              | Keyword     | Identifies the current run                   |
| `TaskQueue`                          | Keyword     | Task queue used                              |
| `HistoryLength`                      | Int         | Number of events (closed only)               |
| `HistorySizeBytes`                   | Long        | Size of event history                        |
| `StateTransitionCount`               | Int         | Number of state persists (closed only)       |
| `BuildIds`                           | KeywordList | Worker build IDs that processed the workflow |
| `BatcherUser`                        | Keyword     | User who started batch operation             |
| `BinaryChecksums`                    | KeywordList | Worker binary IDs (deprecated)               |
| `TemporalScheduledStartTime`         | Datetime    | Scheduled start time                         |
| `TemporalScheduledById`              | Keyword     | Schedule ID that started the workflow        |
| `TemporalSchedulePaused`             | Boolean     | Whether schedule is paused                   |
| `TemporalWorkerDeployment`           | Keyword     | Worker deployment name                       |
| `TemporalWorkerDeploymentVersion`    | Keyword     | Worker deployment version                    |
| `TemporalWorkflowVersioningBehavior` | Keyword     | Versioning behavior (Pinned, Auto-Upgrade)   |
| `TemporalChangeVersion`              | KeywordList | Change/version pairs                         |
| `TemporalReportedProblems`           | KeywordList | Workflow task failure info                   |

## Custom Search Attributes

### Supported Types

| Type          | Description                       |
| ------------- | --------------------------------- |
| `Bool`        | Boolean values                    |
| `Datetime`    | Date/time values                  |
| `Double`      | Floating point (4 decimal digits) |
| `Int`         | 64-bit integer                    |
| `Keyword`     | Exact match string                |
| `KeywordList` | List of exact match strings       |
| `Text`        | Full-text searchable string       |

### Limits (per Namespace)

| Type        | MySQL/PostgreSQL/SQLite | Temporal Cloud |
| ----------- | ----------------------- | -------------- |
| Bool        | 3                       | 20             |
| Datetime    | 3                       | 20             |
| Double      | 3                       | 20             |
| Int         | 3                       | 20             |
| Keyword     | 10                      | 40             |
| KeywordList | 3                       | 5              |
| Text        | 3                       | 5              |

Elasticsearch has no Temporal-imposed limit (subject to ES mapping limits).

### Size Limits

- Single value: 2 KB max
- Total per workflow: 40 KB max
- Characters per value: 255 max

### Usage

Custom search attributes are **NOT automatic** — you must explicitly define and emit them in your workflow code. Temporal does not automatically track step-level metadata (durations, retry counts, step names) as queryable attributes.

#### Step 1: Register the attribute (admin operation)

```bash
temporal operator search-attribute create \
  --name Step1Duration --type Int \
  --name OrderId --type Keyword \
  --name Region --type Keyword
```

#### Step 2: Set/update from within workflow code

```typescript
import { upsertSearchAttributes } from "@temporalio/workflow";

// You manually emit these inside your workflow
const start = Date.now();
const result = await step1();
const duration = Date.now() - start;

// Explicitly upsert the search attribute
upsertSearchAttributes({
  Step1Duration: [duration],
  OrderId: [orderId],
  Region: ["us-east"],
});
```

#### Step 3: Query using the custom attributes

```bash
temporal workflow list --query "Step1Duration > 10000 AND OrderId = 'order-123'"
```

#### What IS queryable by default (no code changes):

- `ExecutionStatus`, `WorkflowType`, `WorkflowId`, `RunId`
- `StartTime`, `CloseTime`, `ExecutionTime`, `ExecutionDuration`
- `TaskQueue`, `HistoryLength`, `HistorySizeBytes`

#### What is NOT queryable without manual instrumentation:

- ❌ Individual step/activity durations
- ❌ Step names or step-level metadata
- ❌ Business data (order IDs, customer IDs, amounts)
- ❌ Step retry counts
- ❌ Any custom domain-specific data

**You cannot write `step1.duration > 10s` by default.** You must instrument your workflow code to capture step duration into a custom search attribute, register that attribute, and then query it.

#### Comparison: Automatic vs Manual Step-Level Querying

| Platform                    | Step-level querying                                   | Setup required                        |
| --------------------------- | ----------------------------------------------------- | ------------------------------------- |
| **Temporal**                | Only via manually emitted custom search attributes    | Register attributes + instrument code |
| **Restate**                 | Built-in via `sys_journal` table (automatic)          | None                                  |
| **AWS Lambda Durable**      | No step-level querying                                | N/A                                   |
| **Azure Durable Functions** | Only via `showHistory` response option (no filtering) | None                                  |
| **Vercel Workflow**         | Dashboard only                                        | None                                  |

```typescript
// Set at workflow start
const handle = await client.workflow.start(myWorkflow, {
  taskQueue: "my-queue",
  workflowId: "order-123",
  searchAttributes: {
    CustomerId: ["cust-456"],
    OrderAmount: [99.99],
    Region: ["us-east"],
  },
});

// Update from within workflow code
import { upsertSearchAttributes } from "@temporalio/workflow";
upsertSearchAttributes({
  OrderStatus: ["shipped"],
});
```

## TypeScript SDK (WorkflowClient)

### WorkflowClient Methods

| Method                     | Description                                       |
| -------------------------- | ------------------------------------------------- |
| `start()`                  | Start new workflow, return handle                 |
| `execute()`                | Start + await result                              |
| `list()`                   | List workflows with query filter (async iterable) |
| `count()`                  | Count matching workflows                          |
| `getHandle()`              | Get handle to existing workflow                   |
| `result()`                 | Get result of completed workflow                  |
| `signalWithStart()`        | Signal existing or start+signal                   |
| `executeUpdateWithStart()` | Start + send update, await result                 |
| `startUpdateWithStart()`   | Start + send update, return handle                |

### WorkflowHandle Methods (per-workflow operations)

| Method           | Description            |
| ---------------- | ---------------------- |
| `describe()`     | Get execution details  |
| `cancel()`       | Graceful cancel        |
| `terminate()`    | Force terminate        |
| `signal()`       | Send async signal      |
| `query()`        | Query internal state   |
| `result()`       | Wait for result        |
| `fetchHistory()` | Get full event history |

### SDK Examples

```typescript
import { Client } from "@temporalio/client";

const client = new Client();

// List all running workflows
for await (const wf of client.workflow.list({
  query: "ExecutionStatus = 'Running'",
})) {
  console.log(wf.workflowId, wf.status.name, wf.startTime);
}

// Count failed workflows
const { count } = await client.workflow.count(
  "ExecutionStatus = 'Failed' AND WorkflowType = 'OrderWorkflow'",
);

// Get handle and operate on specific workflow
const handle = client.workflow.getHandle("order-123");
const description = await handle.describe();
console.log(description.status.name); // 'Running'
console.log(description.searchAttributes);

// Cancel a workflow
await handle.cancel();

// Terminate with reason
await handle.terminate("Manual cleanup");

// Signal a workflow
await handle.signal("approvalSignal", { approved: true });

// Query workflow state
const state = await handle.query("getOrderStatus");

// Get full event history
const history = await handle.fetchHistory();
```

## gRPC API (WorkflowService)

The underlying gRPC service exposes all operations programmatically:

| Method                             | Description                         |
| ---------------------------------- | ----------------------------------- |
| `StartWorkflowExecution`           | Start new workflow                  |
| `ListWorkflowExecutions`           | List with query filter (paginated)  |
| `CountWorkflowExecutions`          | Count matching workflows            |
| `DescribeWorkflowExecution`        | Get execution details               |
| `GetWorkflowExecutionHistory`      | Get event history                   |
| `RequestCancelWorkflowExecution`   | Cancel workflow                     |
| `TerminateWorkflowExecution`       | Terminate workflow                  |
| `DeleteWorkflowExecution`          | Delete workflow + history           |
| `SignalWorkflowExecution`          | Send signal                         |
| `SignalWithStartWorkflowExecution` | Signal or start+signal              |
| `QueryWorkflow`                    | Query workflow state                |
| `UpdateWorkflowExecution`          | Send synchronous update             |
| `ResetWorkflowExecution`           | Reset to point in history           |
| `PauseWorkflowExecution`           | Pause workflow                      |
| `UnpauseWorkflowExecution`         | Resume workflow                     |
| `StartBatchOperation`              | Bulk cancel/terminate/delete/signal |
| `DescribeBatchOperation`           | Check batch operation status        |

## Access Methods

| Method               | Description                                |
| -------------------- | ------------------------------------------ |
| **CLI** (`temporal`) | Full command-line access to all operations |
| **TypeScript SDK**   | `@temporalio/client` WorkflowClient        |
| **Go SDK**           | `go.temporal.io/sdk/client`                |
| **Java SDK**         | `io.temporal.client.WorkflowClient`        |
| **Python SDK**       | `temporalio.client.Client`                 |
| **PHP SDK**          | `Temporal\Client\WorkflowClient`           |
| **.NET SDK**         | `Temporalio.Client.TemporalClient`         |
| **gRPC API**         | Direct gRPC calls to WorkflowService       |
| **Web UI**           | Browser-based dashboard with search        |
| **Temporal Cloud**   | Managed service with all access methods    |

## Source Code Confirmation (GitHub)

Temporal is fully open source (Go, MIT license): [github.com/temporalio/temporal](https://github.com/temporalio/temporal)

### Architecture: Visibility is a Completely Separate Store

The source code confirms that the Visibility Store is **architecturally separate** from the workflow execution engine. The engine **explicitly writes** visibility records to the store at specific lifecycle events — it's not a view over internal state.

**1. `VisibilityStore` interface** — defines the separate store contract
([source](https://github.com/temporalio/temporal/blob/main/common/persistence/visibility/store/visibility_store.go))

```go
// Write APIs — engine pushes data TO the visibility store
RecordWorkflowExecutionStarted(ctx, request) error
RecordWorkflowExecutionClosed(ctx, request) error
UpsertWorkflowExecution(ctx, request) error
DeleteWorkflowExecution(ctx, request) error

// Read APIs — queries read FROM the visibility store
ListWorkflowExecutions(ctx, request) (*InternalListExecutionsResponse, error)
CountWorkflowExecutions(ctx, request) (*InternalCountExecutionsResponse, error)
GetWorkflowExecution(ctx, request) (*InternalGetWorkflowExecutionResponse, error)
```

This interface has **two separate implementations**:

- `store/elasticsearch/` — Elasticsearch backend
- `store/sql/` — SQL database backend (MySQL, PostgreSQL, SQLite)

**2. `visibilityManagerImpl`** — the write path
([source](https://github.com/temporalio/temporal/blob/main/common/persistence/visibility/visibility_manager_impl.go))

The engine explicitly calls `store.RecordWorkflowExecutionStarted()` and `store.RecordWorkflowExecutionClosed()` at workflow lifecycle events. This is a **push model** — the engine writes a denormalized record to the visibility store, including:

- WorkflowID, RunID, WorkflowTypeName
- StartTime, CloseTime, ExecutionDuration
- Status, TaskQueue, HistoryLength
- SearchAttributes (serialized), Memo
- ParentWorkflowID, RootWorkflowID

**3. `visibility_manager_dual.go`** — dual-write support
([source](https://github.com/temporalio/temporal/blob/main/common/persistence/visibility/visibility_manager_dual.go))

Supports writing to two visibility stores simultaneously (e.g., during migration from one backend to another).

**4. `visibility_manager_rate_limited.go`** — rate limiting
([source](https://github.com/temporalio/temporal/blob/main/common/persistence/visibility/visibility_manager_rate_limited.go))

Visibility writes and reads are rate-limited separately, confirming they're treated as a separate subsystem.

### Key Architectural Differences vs Restate (from source code)

| Aspect                        | Temporal                                                   | Restate                                             |
| ----------------------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| **Data model**                | Push: engine writes denormalized records to separate store | View: SQL reads directly from engine's live RocksDB |
| **Store isolation**           | Fully separate database (ES/SQL)                           | Same RocksDB instance as engine                     |
| **Write path**                | Explicit `RecordWorkflowExecutionStarted/Closed` calls     | No write path — data is the engine state            |
| **Query impact on execution** | Zero — queries hit separate database                       | Potential — shares I/O with engine                  |
| **Data freshness**            | Eventually consistent (write lag)                          | Real-time (reading live state)                      |
| **Operational cost**          | Must deploy + manage separate database                     | Zero — embedded in engine                           |
| **Custom attributes**         | Must be explicitly written via `UpsertWorkflowExecution`   | Step-level data tracked automatically               |

Unlike platforms with built-in query capabilities (Restate's embedded RocksDB, AWS Lambda's managed API, Azure's managed API), **self-hosted Temporal requires you to deploy and manage a separate Visibility Store database** just to be able to list, search, and filter workflow executions.

### Self-Hosted Reality

- You must set up **two databases**: one for workflow state (Persistence Store) and one for search/querying (Visibility Store)
- For full query capabilities (custom search attributes, complex filters), **Elasticsearch is recommended** — adding significant operational complexity
- Without advanced visibility, you're limited to basic `=` operator with a single default search attribute
- You are responsible for scaling, backups, upgrades, and monitoring of both databases

### Temporal Cloud (Managed)

- All infrastructure is managed by Temporal — no databases to deploy or maintain
- Full query capabilities available out of the box
- Trade-off: vendor lock-in and usage-based pricing

### Comparison with Other Platforms

| Platform                    | Query Infrastructure                   | Operational Overhead                  |
| --------------------------- | -------------------------------------- | ------------------------------------- |
| **Temporal (self-hosted)**  | Deploy Elasticsearch + persistence DB  | High — two databases to manage        |
| **Temporal Cloud**          | Fully managed                          | None                                  |
| **Restate**                 | Embedded RocksDB, SQL queries built-in | None — zero additional infrastructure |
| **AWS Lambda Durable**      | AWS-managed API                        | None                                  |
| **Azure Durable Functions** | Azure-managed API                      | None                                  |
| **Vercel Workflow**         | Dashboard only (no query API)          | None (but no programmatic access)     |

## Limitations

### Query Language

- `ORDER BY` not supported on Temporal Cloud
- `Text` type cannot be used in `ORDER BY` clauses
- Resolution: 1ns on Elasticsearch, 1µs on SQL databases
- Page size default is 1000 results per page

### Custom Search Attributes

- Not supported on Cassandra (requires advanced visibility)
- SQL databases have lower limits than Temporal Cloud
- Values are stored unencrypted (no PII)
- `Text` type words are tokenized (may cause unexpected matches)

### Storage

- Self-hosted requires managing two databases
- Cassandra doesn't support advanced visibility features
- Elasticsearch recommended for production search capabilities
