# Restate vs AWS Lambda Durable Functions Comparison

## Platform Overview

| Aspect              | Restate                      | AWS Lambda Durable Functions |
| ------------------- | ---------------------------- | ---------------------------- |
| **Architecture**    | Self-hosted or cloud service | AWS managed service          |
| **Database**        | Embedded RocksDB             | AWS managed storage          |
| **Query Interface** | SQL-based introspection      | REST API                     |
| **Deployment**      | Single binary (Rust)         | AWS Lambda only              |
| **Storage Model**   | Log-centric with snapshots   | Event sourcing + checkpoints |
| **Pricing**         | Usage-based (Restate Cloud)  | AWS Lambda + storage costs   |

## Query Capabilities Comparison

### ✅ Restate Advantages

| Feature                    | Restate                          | AWS Lambda                 | Impact                               |
| -------------------------- | -------------------------------- | -------------------------- | ------------------------------------ |
| **SQL Flexibility**        | ✅ Full SQL support              | ❌ Fixed REST parameters   | Complex queries, JOINs, aggregations |
| **Status Granularity**     | ✅ 8 status values               | ✅ 5 status values         | More detailed lifecycle tracking     |
| **Time Filtering**         | ✅ Created, modified, completed  | ✅ Started only            | Better temporal queries              |
| **Retry Information**      | ✅ Detailed retry/failure data   | ❌ Limited                 | Deep troubleshooting capabilities    |
| **Service Hierarchy**      | ✅ Service/handler/key filtering | ✅ Function/execution name | Equivalent granularity               |
| **Real-time Queries**      | ✅ Live SQL interface            | ✅ REST API                | Both support real-time               |
| **Database Independence**  | ✅ Embedded RocksDB              | ❌ AWS managed only        | No external DB dependencies          |
| **Operational Simplicity** | ✅ Single binary deployment      | ❌ Multiple AWS services   | Reduced operational overhead         |

### ✅ AWS Lambda Advantages

| Feature                 | Restate               | AWS Lambda             | Impact                   |
| ----------------------- | --------------------- | ---------------------- | ------------------------ |
| **REST API**            | ❌ SQL only           | ✅ Standard REST       | Easier integration       |
| **Pagination**          | ✅ SQL LIMIT/OFFSET   | ✅ Marker-based        | Both support pagination  |
| **Function Versioning** | ❌ No equivalent      | ✅ Qualifier parameter | Version-specific queries |
| **Managed Service**     | ⚠️ Self-host or cloud | ✅ Fully managed       | Operational overhead     |
| **AWS Integration**     | ❌ External platform  | ✅ Native AWS          | Ecosystem integration    |

## Status Mapping

| Restate Status        | AWS Equivalent     | Notes                                  |
| --------------------- | ------------------ | -------------------------------------- |
| `pending`             | `RUNNING` (queued) | Restate distinguishes queued vs active |
| `scheduled`           | ❌ No equivalent   | Restate-specific delayed execution     |
| `ready`               | `RUNNING` (ready)  | Restate pre-execution state            |
| `running`             | `RUNNING`          | Direct equivalent                      |
| `paused`              | ❌ No equivalent   | Restate pause/resume capability        |
| `backing-off`         | ❌ No equivalent   | Restate retry backoff state            |
| `suspended`           | ❌ No equivalent   | Restate external wait state            |
| `completed` (success) | `SUCCEEDED`        | Direct equivalent                      |
| `completed` (failure) | `FAILED`           | Direct equivalent                      |
| ❌ No equivalent      | `TIMED_OUT`        | AWS-specific timeout status            |
| ❌ No equivalent      | `STOPPED`          | AWS manual termination                 |

## Query Examples Comparison

### Simple Status Filter

**Restate (SQL):**

```sql
SELECT id, target, status FROM sys_invocation
WHERE status IN ('running', 'suspended')
```

**AWS Lambda (REST):**

```bash
GET /functions/MyFunction/durable-executions?Statuses=RUNNING,FAILED
```

### Time-based Filtering

**Restate (SQL):**

```sql
SELECT * FROM sys_invocation
WHERE created_at >= '2026-04-01T00:00:00Z'
  AND modified_at >= '2026-04-13T00:00:00Z'
```

**AWS Lambda (REST):**

```bash
GET /functions/MyFunction/durable-executions?StartedAfter=2026-04-01T00:00:00Z
```

### Complex Queries

**Restate (SQL):**

```sql
SELECT target_service_name, status, COUNT(*) as count,
       AVG(retry_count) as avg_retries
FROM sys_invocation
WHERE created_at >= NOW() - INTERVAL '1 day'
GROUP BY target_service_name, status
HAVING COUNT(*) > 10
ORDER BY count DESC
```

**AWS Lambda (REST):**

```
❌ Not possible - requires multiple API calls and client-side aggregation
```

## Feature Gap Analysis

### Missing in Restate

- **REST API** - Only SQL interface available
- **Function versioning** - No equivalent to AWS Qualifier
- **Timeout status** - No specific timeout differentiation
- **Built-in pagination** - Relies on SQL LIMIT/OFFSET
- **AWS ecosystem** - External to AWS services

### Missing in AWS Lambda

- **SQL flexibility** - Fixed REST parameters only
- **Granular status** - Fewer lifecycle states
- **Retry details** - Limited failure information
- **Modified time** - Only creation time filtering
- **Pause/resume** - No workflow suspension
- **Aggregation queries** - No built-in analytics

### Missing in Both

- **Metadata filtering** - No custom tag/label support
- **Performance metrics** - No duration/resource filtering
- **Batch operations** - No bulk status updates
- **Advanced search** - No full-text search capabilities

## Use Case Recommendations

### Choose Restate When:

- Need complex analytical queries
- Require detailed retry/failure analysis
- Want pause/resume workflow capabilities
- Need multi-cloud or on-premises deployment
- Prefer SQL-based introspection
- Building event-driven architectures

### Choose AWS Lambda When:

- Already invested in AWS ecosystem
- Need fully managed service
- Prefer REST API integration
- Require function version filtering
- Want native AWS service integration
- Building serverless-first applications

## Conclusion

**Restate** provides superior query flexibility through SQL and more granular workflow lifecycle management, making it ideal for complex operational analytics and debugging scenarios.

**AWS Lambda Durable Functions** offers better integration with AWS services and a more familiar REST API approach, making it suitable for AWS-native applications with standard monitoring needs.

Both platforms excel in different areas: Restate for operational intelligence and AWS Lambda for ecosystem integration.
