# Workflow Observability Requirements — Theme / Category / Ask Tree

```
A. Real-Time Operational Awareness
├── What's happening right now?
│   ├── Real-time count of workflows by status
│   ├── Stuck detection (RUNNING past expected duration)
│   ├── Queue depth monitoring
│   └── Progress indicators (alive vs making forward progress)
├── Throughput & capacity
│   ├── Workflows started/completed per second
│   ├── Queue depth and wait time
│   ├── Worker utilization (busy vs idle)
│   ├── Concurrency tracking
│   ├── Capacity forecasting
│   └── Rate limit visibility
├── Progress & ETA during execution
│   ├── Progress percentage
│   ├── Throughput rate (records/sec)
│   ├── ETA / estimated completion
│   ├── Items processed vs total
│   ├── Progress history (stable, increasing, degrading)
│   └── Structured heartbeat data
└── Effective availability / dependency-aware uptime
    ├── Effective workflow availability (success rate over time)
    ├── Dependency-aware composite uptime
    ├── Downtime attribution (which dependency caused it)
    ├── Dependency health impact
    ├── SLA composition from dependency SLAs
    └── Availability trending

B. Failure Diagnosis
├── Why did it fail?
│   ├── Step-level error attribution
│   ├── Error context (inputs, outputs, state at failure)
│   ├── Retry history (attempts + errors per attempt)
│   ├── Failure categorization (transient vs permanent)
│   └── Stack traces
├── What happened to this specific workflow?
│   ├── Lookup by business ID
│   ├── Full execution timeline (steps, waits, retries)
│   ├── Input/output per step
│   ├── Trigger source (API, cron, event, manual)
│   ├── Related workflows (parent/child)
│   └── Query handlers (ask running workflow its state)
├── Soft failures & degradation
│   ├── Retry rate per step over time
│   ├── Soft error categorization
│   ├── Success-with-retries vs clean-success distinction
│   ├── Downstream health inference
│   └── Data quality validation
├── Partial failure in parallel branches
│   ├── Per-branch status in fan-out/fan-in
│   ├── Conditional path tracking (which branch taken, why)
│   ├── Critical path data
│   ├── Execution path visualization
│   └── Partial failure alerting
└── Replay / reproduce locally
    ├── Export execution history
    ├── Local replay against local code
    ├── Replay compatibility testing
    └── Step-through debugging

C. Performance Analysis
├── Why is it slow?
│   ├── Per-step duration (start + end time)
│   ├── Duration percentiles (p50/p95/p99) per step
│   ├── Bottleneck identification
│   ├── Downstream dependency correlation
│   └── Anomaly detection (10x slower than average)
├── Batch window / processing deadline
│   ├── Window utilization trending
│   ├── Critical chain identification
│   ├── Rerun impact analysis
│   ├── Window completion forecast
│   └── Window breach early warning
├── Compute vs wait time breakdown
│   ├── Compute time vs wall-clock time per step
│   ├── Resume latency (event received → code executing)
│   ├── Replay/rehydration overhead
│   ├── Suspend/resume frequency
│   └── Idle cost verification
└── Workflow internal health
    ├── Event history size (events + bytes)
    ├── Replay duration
    ├── Worker memory per workflow
    ├── ContinueAsNew tracking
    ├── Workflow age
    └── Platform limit proximity alerts

D. Search & Discovery
├── Cross-workflow search & filtering
│   ├── Custom search attributes (indexed business data)
│   ├── Multi-criteria filtering (status AND time AND name AND custom)
│   ├── Step-level filtering (workflows where step X failed)
│   ├── Aggregation (count by status, type, error)
│   └── Saved queries / views
└── Bulk operations
    ├── Bulk cancel/terminate by query
    ├── Bulk retry/resume
    ├── Bulk pause
    ├── Rate-limited bulk operations
    └── Dry-run mode

E. Business Outcomes & SLAs
├── SLA compliance
│   ├── End-to-end workflow duration (business time)
│   ├── Completion rate by workflow type
│   ├── Business-tagged metrics (tier, region, type)
│   ├── SLA breach alerting
│   └── Trend dashboards
├── STP / automation rate
│   ├── Percentage completing without manual intervention
│   ├── Exception/fallout tracking
│   ├── Fallout by step
│   ├── STP rate trending
│   └── Cost of manual intervention
└── Analytics & BI by business dimensions
    ├── Aggregate duration metrics (avg, median, p95, p99)
    ├── Business dimension tags per workflow
    ├── Cohort analysis
    ├── Trend analysis by dimension
    ├── Funnel analysis (drop-off per stage)
    └── Distribution visualization (histograms)

F. Data Integrity & Correctness
├── Output correctness validation
│   ├── Output assertions (schema, range, count)
│   ├── Comparison with previous runs
│   ├── Anomaly detection on outputs
│   ├── Business rule validation
│   └── Silent failure alerting
├── Data freshness / staleness
│   ├── Freshness tracking per output
│   ├── Freshness SLAs
│   ├── Upstream propagation (stale because upstream stale)
│   ├── Staleness alerting
│   └── Freshness dashboard
├── Cross-party reconciliation
│   ├── Match rate across systems
│   ├── Break/mismatch records
│   ├── Field-level mismatch detail
│   ├── Break aging
│   └── Reconciliation dashboard
├── Schema / contract drift
│   ├── Schema versioning over time
│   ├── Contract validation results
│   ├── Impact analysis (schema changed → affected workflows)
│   ├── Backward compatibility checks
│   └── Schema change alerting
└── Safety invariant monitoring
    ├── Continuous invariant checking at every state transition
    ├── Proof of compliance (auditable evidence)
    ├── Degraded mode tracking
    ├── Conflict detection (concurrent mutual exclusion)
    └── Invariant violation alerting (immediate)

G. Lifecycle Management
├── Version & deployment safety
│   ├── Version tag per workflow
│   ├── Version distribution (count per version)
│   ├── Version-tagged filtering
│   ├── Replay compatibility testing
│   ├── Deployment safety checks
│   └── Gradual migration tracking
├── Missed schedule detection
│   ├── Schedule execution history
│   ├── Backfill tracking
│   ├── Missed schedule alerting
│   └── Schedule health dashboard
├── Execution overlap / collision
│   ├── Concurrent execution count per workflow type
│   ├── Collision impact tracking
│   ├── Overlap detection alerting
│   └── Overlap prevention policies (skip, queue, kill-previous)
├── Resource leak / orphaned holds
│   ├── Resource hold registry (all temp holds)
│   ├── TTL per hold
│   ├── Orphaned resource detection
│   ├── Resource leak trending
│   └── Cleanup verification alerting
└── Desired vs actual convergence
    ├── Convergence rate (% at desired state)
    ├── Convergence time
    ├── Non-converged target identification
    ├── Rollout progress tracking
    └── Divergence alerting

H. External Integration & Export
├── OTel / APM integration
│   ├── Structured logs with workflow ID correlation
│   ├── Replay-safe instrumentation
│   ├── CDC/streaming export to data warehouses
│   ├── OpenTelemetry traces with span links
│   ├── Metrics export (Prometheus/StatsD/OTLP)
│   └── Webhook/event hooks
└── Real-time notifications / webhooks
    ├── Event streaming (subscribe to workflow events)
    ├── Webhook on lifecycle events
    ├── Configurable notification channels (Slack, PagerDuty, email)
    ├── Selective subscriptions (by type or status)
    └── UI push updates (no polling)

I. Security, Compliance & Governance
├── Audit trail
│   ├── User attribution (who started, cancelled, modified)
│   ├── Immutable execution history
│   ├── Retention policies
│   ├── Export for auditors
│   └── Access control on observability data
└── PII / sensitive data protection
    ├── Codec/encryption at rest
    ├── Selective visibility (names + timing, hide data)
    ├── Payload redaction/masking
    ├── Role-based observability access
    └── Configurable data retention

J. Cost & Resource Attribution
└── Cost / resource attribution
    ├── Per-workflow cost (compute, API calls, storage)
    ├── Per-step cost breakdown
    ├── Token/API call tracking (LLM costs)
    ├── Cost trends over time
    └── Budget alerts

K. Dependency & Impact Analysis
└── Blast radius / dependency mapping
    ├── Dependency map per workflow type
    ├── Parent-child relationships
    ├── Impact analysis (service down → affected workflows)
    ├── Cross-workflow correlation by business transaction
    ├── Proactive dependency degradation alerting
    └── Parent-child visualization
```
