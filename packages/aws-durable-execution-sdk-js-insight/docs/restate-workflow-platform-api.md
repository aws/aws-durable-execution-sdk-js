# Restate Workflow Platform API

## Overview

Restate is a durable execution platform that enables workflows-as-code with automatic state persistence, retry logic, and failure recovery. Unlike traditional workflow orchestrators, Restate allows writing workflows in regular programming languages without YAML configurations.

## Database Technology

**Storage Engine**: **RocksDB**

- High-performance embedded key-value store with LSM-tree architecture
- Originally developed by Facebook, optimized for SSD storage
- Self-contained within Restate's single Rust binary
- No external database dependencies required

**Architecture Benefits**:

- **Embedded storage**: No separate database to manage or configure
- **Log-centric design**: Built around durable command log ("Bifrost")
- **Write-optimized**: LSM-tree structure ideal for workflow logging
- **Operational simplicity**: Single binary deployment with built-in persistence

## SQL Introspection API

### Architecture: Read-Only View Over Engine State

The SQL introspection tables (`sys_invocation`, `sys_journal`, etc.) are **not a separate observability database**. They are **read-only views directly into the engine's live internal state** stored in RocksDB.

```
┌─────────────────────────────────────────────────┐
│              Restate Engine                      │
│                                                  │
│   Durable Log ("Bifrost") ← source of truth      │
│         │                                        │
│         ▼                                        │
│   Partition Processor                            │
│   ┌─────────────────────────────────────┐        │
│   │ RocksDB (materialized state cache)  │        │
│   │ • Invocation state ← engine uses    │        │
│   │ • Journal entries  ← engine uses    │        │
│   │ • Service state    ← engine uses    │        │
│   │ • Timers, inbox    ← engine uses    │        │
│   └──────────────┬──────────────────────┘        │
│                  │                               │
│                  ▼                               │
│   ┌─────────────────────────────────────┐        │
│   │ SQL Introspection (read-only view)  │        │
│   │ sys_invocation, sys_journal, etc.   │        │
│   └─────────────────────────────────────┘        │
└─────────────────────────────────────────────────┘
```

**Key implications:**

- The data you query IS the data the engine uses to run workflows — not a copy
- No separate database to deploy, manage, or sync
- Queries always reflect the current live state
- **No custom instrumentation needed** — step names, retry counts, journal entries are tracked automatically as part of normal engine operation

### Potential Query Impact on Workflow Execution

Because the SQL introspection reads from the **same RocksDB instance** that the Partition Processor uses for workflow execution, **heavy queries could theoretically compete for I/O and CPU resources** with the workflow engine.

**What we know:**

- RocksDB supports concurrent reads efficiently via snapshots (reads don't block writes)
- The SQL interface is read-only, so it won't lock or block writes
- However, large table scans could increase I/O pressure and CPU usage on the same process
- Restate 1.5 release notes mention "faster SQL queries (more responsive UI)" — suggesting query performance was a known concern

**Practical considerations:**

- Simple filtered queries (e.g., `WHERE status = 'running'`) should have minimal impact
- Full table scans across millions of invocations could affect performance
- In clustered deployments, queries could potentially be served by follower partition processors rather than the leader
- No documented query isolation guarantees or resource limits for SQL queries

### Source Code Confirmation (GitHub)

The source code confirms our findings. Key crates:

**1. `storage-query-datafusion`** — SQL query engine
([source](https://github.com/restatedev/restate/tree/main/crates/storage-query-datafusion/src))

- Uses **Apache DataFusion** as the SQL query engine (not a custom SQL parser)
- Depends directly on `restate-partition-store` — the same crate the engine uses for workflow execution
- Each SQL table (`invocation_status/`, `journal/`, `state/`, `inbox/`, etc.) has a corresponding DataFusion table provider that reads from the partition store

**2. `partition-store`** — Shared RocksDB storage
([source](https://github.com/restatedev/restate/tree/main/crates/partition-store/src))

- Contains the actual RocksDB tables: `invocation_status_table/`, `journal_table/`, `inbox_table/`, `state_table/`, `promise_table/`, `timer_table/`, etc.
- These are the **same tables** the Partition Processor reads/writes during workflow execution
- The SQL layer reads from these tables via `PartitionStoreManager.get_partition_store(partition_id)`

**3. `partition_store_scanner.rs`** — How queries read from the engine
([source](https://github.com/restatedev/restate/blob/main/crates/storage-query-datafusion/src/partition_store_scanner.rs))

Key code pattern:

```rust
// SQL queries get a reference to the SAME partition store the engine uses
let partition_store = partition_store_manager
    .get_partition_store(partition_id)
    .await
    .ok_or_else(|| { /* partition doesn't exist on this node */ })?;

// Then scan rows directly from it using DataFusion
S::for_each_row(&partition_store, filter, |row| {
    S::append_row(batch_sender.builder_mut(), row)
});
```

This confirms:

- **No snapshot isolation**: Queries read directly from the live `PartitionStore`, not a snapshot copy
- **Same process**: Query execution happens in the same async runtime as the Partition Processor
- **Partition-aware**: Queries are routed to the node that owns each partition, and in clusters, `remote_query_scanner_client.rs` / `remote_query_scanner_server.rs` handle cross-node query fan-out
- **Predicate pushdown**: Filters are pushed down to the scan level (`S::Filter::new(range, predicate)`) for efficiency

**Comparison with other platforms:**
| Platform | Query isolation from execution |
|---|---|
| **Restate** | Shared RocksDB — queries read from same store engine uses |
| **Temporal (self-hosted)** | Fully isolated — separate Visibility Store database |
| **Temporal Cloud** | Fully isolated — managed separately |
| **AWS Lambda Durable** | Fully isolated — AWS-managed API |
| **Azure Durable Functions** | Fully isolated — Azure-managed API |

### Self-Hosted Access

- **Restate CLI**: `restate sql "SELECT * FROM sys_invocation"`
- **HTTP API**: `POST /query` with SQL in request body
- **Restate UI**: Built-in query interface

### Restate Cloud (Hosted) Access

- **Cloud UI**: Web-based SQL query editor in dashboard
- **CLI with Auth**: `restate cloud login && restate sql --env <env> "query"`
- **HTTP API**: `POST https://<workspace>.restate.cloud/query` with Bearer token
- **Authentication**: Restate Cloud account credentials and API tokens
- **Environment Isolation**: Queries scoped to specific environments (prod/staging)
- **Permissions**: Workspace-level team access, read-only introspection

## sys_invocation Table

The primary table for querying workflow invocations with comprehensive filtering capabilities.

### Key Columns

| Column                | Type                   | Description                                             |
| --------------------- | ---------------------- | ------------------------------------------------------- |
| `id`                  | `Utf8`                 | Unique invocation ID (starts with `inv_`)               |
| `target`              | `Utf8`                 | Service/handler target (e.g., `OrderService/process`)   |
| `target_service_name` | `Utf8`                 | Service name                                            |
| `target_service_key`  | `Utf8`                 | Virtual object key or workflow ID                       |
| `target_handler_name` | `Utf8`                 | Handler method name                                     |
| `target_service_ty`   | `Utf8`                 | Service type: `service`, `virtual_object`, `workflow`   |
| `status`              | `Utf8`                 | Current invocation status                               |
| `created_at`          | `TimestampMillisecond` | Invocation start time                                   |
| `modified_at`         | `TimestampMillisecond` | Last status change time                                 |
| `completed_at`        | `TimestampMillisecond` | Completion time (if completed)                          |
| `idempotency_key`     | `Utf8`                 | User-provided idempotency key                           |
| `invoked_by`          | `Utf8`                 | Invocation source: `ingress`, `service`, `subscription` |
| `retry_count`         | `UInt64`               | Number of retry attempts                                |
| `last_failure`        | `Utf8`                 | Most recent error message                               |

### Status Values

- `pending` - Queued for execution
- `scheduled` - Scheduled for future execution
- `ready` - Ready to run
- `running` - Currently executing
- `paused` - Temporarily paused
- `backing-off` - Waiting before retry
- `suspended` - Suspended (waiting for external input)
- `completed` - Finished execution

### Completion Results

When `status = 'completed'`:

- `completion_result`: `success` or `failure`
- `completion_failure`: Error details (if failed)

## Advanced Querying with sys_journal

### Automatic Step-Level Introspection (No Code Instrumentation Required)

Unlike Temporal (which requires manually emitting custom search attributes for step-level data), Restate **automatically tracks every operation** in the `sys_journal` table. You can query step names, retry counts, and operation-level details **out of the box** without any workflow code changes.

### Query Operations by Name and Retry Count

```sql
-- Find invocations with 'step1' operation that retried 3 times
SELECT
    inv.id,
    inv.target,
    inv.status,
    inv.retry_count,
    inv.last_failure,
    j.name as operation_name
FROM sys_invocation inv
JOIN sys_journal j ON inv.id = j.id
WHERE j.name = 'step1'
  AND inv.retry_count = 3
ORDER BY inv.created_at DESC;
```

### Query Failed Operations

```sql
-- Find failed operations with specific names
SELECT
    inv.id,
    inv.target,
    inv.retry_count,
    inv.last_failure_related_command_name,
    j.name as step_name,
    j.completed
FROM sys_invocation inv
JOIN sys_journal j ON inv.id = j.id
WHERE j.name IN ('step1', 'payment', 'notification')
  AND inv.last_failure IS NOT NULL;
```

## Example Queries

### Filter by Status

```sql
SELECT id, target, status, created_at
FROM sys_invocation
WHERE status IN ('running', 'suspended')
```

### Filter by Service

```sql
SELECT id, target_handler_name, status, retry_count
FROM sys_invocation
WHERE target_service_name = 'OrderService'
```

### Filter by Time Range

```sql
SELECT id, target, status, created_at
FROM sys_invocation
WHERE created_at >= '2026-04-01T00:00:00Z'
  AND created_at <= '2026-04-14T23:59:59Z'
```

### Filter by Failure Status

```sql
SELECT id, target, last_failure, retry_count
FROM sys_invocation
WHERE status = 'completed'
  AND completion_result = 'failure'
```

### Complex Filtering

```sql
SELECT id, target, status, created_at, retry_count
FROM sys_invocation
WHERE target_service_name LIKE 'Order%'
  AND status IN ('running', 'backing-off')
  AND retry_count > 1
  AND created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
```

## Key Features

- **Full SQL Support** - Complex queries with JOINs, aggregations, and functions
- **Real-time Data** - Live view of invocation status and progress
- **Rich Metadata** - Comprehensive invocation lifecycle tracking
- **Flexible Filtering** - Filter by any column combination
- **Time-based Queries** - Created, modified, and completed timestamps
- **Retry Tracking** - Detailed failure and retry information
- **Service Hierarchy** - Service, handler, and key-based filtering
- **Idempotency Support** - Query by idempotency keys

## Authentication & Access Control

### Restate Cloud (Hosted)

```bash
# Authenticate with cloud
restate cloud login

# Environment-specific queries
restate sql --env production "SELECT COUNT(*) FROM sys_invocation"
restate sql --env staging "SELECT COUNT(*) FROM sys_invocation"

# HTTP API with token
curl -X POST https://workspace-id.restate.cloud/query \
  -H "Authorization: Bearer <api-token>" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT id, status FROM sys_invocation LIMIT 10"}'
```

### Access Controls

- **Workspace-level**: Team member permissions
- **Environment isolation**: Production vs staging separation
- **Read-only access**: Introspection tables are query-only
- **API-mediated**: No direct database connections in hosted mode

## Management Operations

### Cancel Invocation

```bash
restate invocations cancel <invocation-id>
```

### Kill Invocation

```bash
restate invocations kill <invocation-id>
```

### Purge Completed

```bash
restate invocations purge --status completed --older-than 7d
```

## Limitations

### Self-Hosted

- Requires SQL knowledge for complex queries
- No predefined filtering endpoints
- Limited to introspection (read-only queries)

### Restate Cloud (Hosted)

- No direct database access (API-mediated only)
- Environment-scoped queries only
- Requires authentication tokens for programmatic access
- Network latency for external queries
