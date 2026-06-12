# Operator at Scale — Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          COMPUTE (Lambda Invocation)                            │
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                      Durable Function SDK                                 │  │
│  │                                                                           │  │
│  │   ┌─────────────────┐     ┌────────────────────────────────────────────┐  │  │
│  │   │  Workflow Code  │     │  Operator at Scale Plugin                  │  │  │
│  │   │                 │     │                                            │  │  │
│  │   │  • Steps        │     │  ┌──────────────┐   ┌───────────────────┐  │  │  │
│  │   │  • Waits        │────►│  │ Data Curator │──►│  Internal Queue   │  │  │  │
│  │   │  • Callbacks    │     │  │              │   │  (batch + dedup)  │  │  │  │
│  │   │  • Invokes      │     │  │ • Field      │   │                   │  │  │  │
│  │   │                 │     │  │   selection  │   │  • Newer records  │  │  │  │
│  │   │                 │     │  │ • Truncation │   │    supersede old  │  │  │  │
│  │   │                 │     │  │ • Custom     │   │  • Flush on       │  │  │  │
│  │   │                 │     │  │   fields     │   │    suspend/done   │  │  │  │
│  │   └─────────────────┘     │  └──────────────┘   └────────┬──────────┘  │  │  │
│  │                           │                              │             │  │  │
│  │   ┌─────────────────┐     │  Configuration:              │             │  │  │
│  │   │ Execution State │     │  • Destination(s)            │             │  │  │
│  │   │ (GetDurable     │────►│  • Sampling rate             │             │  │  │
│  │   │ ExecutionState) │     │  • Fields to include         │             │  │  │
│  │   │                 │     │  • Mode (in-progress/done)   │             │  │  │
│  │   └─────────────────┘     │  • Size limits               │             │  │  │
│  │                           └──────────────────────────────┼─────────────┘  │  │
│  └───────────────────────────────────────────────────────────┼───────────────┘  │
└──────────────────────────────────────────────────────────────┼──────────────────┘
                                                               │
                                              Async, non-blocking emission
                                                               │
                         ┌─────────────────────────────────────┼──────────────────────────┐
                         │                                     ▼                          │
                         │              DATA DESTINATIONS (Customer-Owned)                │
                         │                                                                │
                         │   ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐     │
                         │   │     S3       │  │  DynamoDB    │  │ CloudWatch Logs  │     │
                         │   │              │  │              │  │                  │     │
                         │   │ • Athena     │  │ • Fast ID    │  │ • Log Insights   │     │
                         │   │   queries    │  │   lookups    │  │   queries        │     │
                         │   │ • Parquet    │  │ • TTL-based  │  │ • Zero setup     │     │
                         │   │ • Cheapest   │  │   retention  │  │ • Integrated     │     │
                         │   └──────────────┘  └──────────────┘  └──────────────────┘     │
                         │                                                                │
                         │   ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐     │
                         │   │   Aurora     │  │   Kinesis    │  │  EventBridge     │     │
                         │   │              │  │              │  │                  │     │
                         │   │ • Full SQL   │  │ • Streaming  │  │ • Event routing  │     │
                         │   │ • Indexes    │  │ • Fan-out    │  │ • Trigger actions│     │
                         │   │ • Best all-  │  │ • Buffered   │  │ • Downstream     │     │
                         │   │   rounder    │  │   delivery   │  │   reactions      │     │
                         │   └──────────────┘  └──────────────┘  └──────────────────┘     │
                         │                                                                │
                         │   ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐     │
                         │   │   Datadog    │  │   Splunk     │  │  Grafana Cloud   │     │
                         │   │  (direct)    │  │  (direct)    │  │  (direct)        │     │
                         │   └──────────────┘  └──────────────┘  └──────────────────┘     │
                         │                                                                │
                         │   ┌──────────────────────────────────────────────────────┐     │
                         │   │  Any OTel-compatible destination (via OTel logs)     │     │
                         │   └──────────────────────────────────────────────────────┘     │
                         │                                                                │
                         └────────────────────────────────┬───────────────────────────────┘
                                                          │
                                                          │ Customer queries their own data
                                                          │
                         ┌────────────────────────────────┼───────────────────────────────┐
                         │                                ▼                               │
                         │              QUERY & VISUALIZATION LAYER                       │
                         │                                                                │
                         │   ┌─────────────────────────────────────────────────────┐      │
                         │   │  1  Workflow Insight UI (AWS Lambda Console)        │      │
                         │   │                                                     │      │
                         │   │  • Structured filters + Natural language query      │      │
                         │   │  • Queries customer's AWS destination directly      │      │
                         │   │  • Uses customer's IAM role                         │      │
                         │   │  • Works out-of-the-box with S3, DDB, CW, Aurora    │      │
                         │   └─────────────────────────────────────────────────────┘      │
                         │                                                                │
                         │   ┌─────────────────────────────────────────────────────┐      │
                         │   │  2 Open-Source React Components (Custom UI)         │      │
                         │   │                                                     │      │
                         │   │  • Pre-built widgets (execution table, step         │      │
                         │   │    timeline, duration charts, status filters)       │      │
                         │   │  • Customer hosts & customizes                      │      │
                         │   │  • Pluggable query adapter for any destination      │      │
                         │   │  • Embed in internal dashboards / ops portals       │      │
                         │   └─────────────────────────────────────────────────────┘      │
                         │                                                                │
                         │   ┌─────────────────────────────────────────────────────┐      │
                         │   │  3 Native Destination Tools (Bring Your Own)        │      │
                         │   │                                                     │      │
                         │   │  • Athena SQL console (for S3)                      │      │
                         │   │  • CloudWatch Log Insights (for CW Logs)            │      │
                         │   │  • Grafana / Datadog dashboards                     │      │
                         │   │  • Any SQL client (for Aurora)                      │      │
                         │   │  • Customer's existing tools — no lock-in           │      │
                         │   └─────────────────────────────────────────────────────┘      │
                         │                                                                │
                         └────────────────────────────────────────────────────────────────┘
```

## Data Flow Summary

```
Workflow executes
       │
       ▼
SDK reads execution state (GetDurableExecutionState)
       │
       ▼
Plugin curates record (field selection, truncation, custom fields)
       │
       ▼
Internal queue (batches, deduplicates — newer supersedes older)
       │
       ▼
Async flush to destination(s) ──── non-blocking, never fails the workflow
       │
       ▼
Data lands in customer-owned storage
       │
       ▼
Customer queries via: Console UI │ React Components │ Native Tools
```
