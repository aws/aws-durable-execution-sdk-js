# Workflow Observability Requirements — Detailed Tree

A. Real-Time Operational Awareness

- What's happening right now?
  - Real-time count by status — "how many running, queued, failed right now?"
  - Stuck detection — workflows in RUNNING state past expected duration with no step progress
  - Queue depth — how many workflows waiting to be picked up by a worker
  - Progress indicators — distinguish "alive but idle" from "actively making forward progress"
- Throughput & capacity
  - Workflows started/completed per second — are we keeping up with incoming load?
  - Queue wait time — how long between enqueue and first step execution
  - Worker utilization — percentage of workers actively processing vs idle
  - Concurrency — how many workflows executing simultaneously right now
  - Capacity forecasting — at current growth, when do we hit limits?
  - Rate limit visibility — are downstream API limits causing backpressure?
- Progress & ETA during execution
  - Progress percentage — "this workflow is 73% complete"
  - Throughput rate — "processing 1,200 records/minute"
  - ETA — "estimated completion in 45 minutes"
  - Items processed vs total — "73,000 of 100,000 records done"
  - Progress trend — is throughput stable, increasing, or degrading over time?
  - Structured heartbeat — rich progress payload, not just "still alive"
- Effective availability / dependency-aware uptime
  - Workflow success rate — "97.2% of executions completed successfully this month"
  - Composite uptime — "depends on 5 services × their uptimes = theoretical max 98.2%"
  - Downtime attribution — "30 min from payment API, 12 min from shipping, 5 min our code"
  - Dependency health impact — "payment API degradation caused 342 failures today"
  - SLA composition — "best we can promise given dependencies is 98.5%"
  - Availability trending — improving or degrading month over month?

B. Failure Diagnosis

- Why did it fail?
  - Step-level error — "step 'charge-card' failed with TimeoutError"
  - Error context — inputs/outputs/state at the exact moment of failure
  - Retry history — "failed 3 times: timeout, timeout, connection refused"
  - Failure category — transient (retry-worthy) vs permanent (bug in code)
  - Stack traces — full code-level trace for debugging
- What happened to this specific workflow?
  - Lookup by business ID — "find workflow for order #12345"
  - Full timeline — every step, wait, retry, signal in chronological order
  - Input/output per step — what data flowed through each operation
  - Trigger source — was it started by API call, cron, event, or manual action?
  - Related workflows — parent that spawned it, children it created
  - Query handlers — ask a running workflow "what are you doing right now?"
- Soft failures & degradation
  - Retry rate per step — "payment step retrying 15% of the time this hour"
  - Soft error categories — timeouts handled internally but indicating degradation
  - Success-with-retries — distinguish clean success from "succeeded after 3 retries"
  - Downstream inference — "step X retry rate correlates with service Y latency"
  - Data quality — workflow succeeded but output was incomplete or wrong
- Partial failure in parallel branches
  - Per-branch status — "3 of 5 parallel branches succeeded, 2 failed"
  - Conditional path — "took the 'premium' branch because tier=gold"
  - Critical path — which branch sequence determined total duration
  - Path visualization — graphical view of which branches ran/skipped/failed
  - Partial failure alert — "workflow reported success but branch 'notify' failed"
- Replay / reproduce locally
  - Export history — download full execution record (inputs, outputs, events)
  - Local replay — re-run production history against local code for debugging
  - Compatibility testing — verify new code replays correctly against old histories
  - Step-through — walk through execution one step at a time like a debugger

C. Performance Analysis

- Why is it slow?
  - Per-step duration — "validate: 50ms, charge: 8200ms, notify: 120ms"
  - Duration percentiles — "charge step p50=200ms, p95=3s, p99=12s"
  - Bottleneck identification — "charge step accounts for 85% of total duration"
  - Dependency correlation — "charge step slow when payment-api p99 > 5s"
  - Anomaly detection — "charge step is 10x slower than its 7-day average"
- Batch window / processing deadline
  - Window utilization — "batch window is 80% full and growing 2% per week"
  - Critical chain — "jobs A→C→F determine the window end time"
  - Rerun impact — "if job C reruns, window overruns by 20 minutes"
  - Completion forecast — "at current rate, all jobs finish 40 min before deadline"
  - Breach early warning — alert when window is at risk, not after it's blown
- Compute vs wait time breakdown
  - Compute vs wall-clock — "4 hours wall-clock, 45 seconds actual compute"
  - Resume latency — "800ms from callback arrival to code executing"
  - Replay overhead — "of 800ms resume, 600ms is replaying history"
  - Suspend/resume frequency — "this workflow suspended 47 times"
  - Idle cost verification — "confirm billing is for 45s compute, not 4h wall-clock"
- Workflow internal health
  - History size — "12,847 events, 2.3MB — approaching 50K limit"
  - Replay duration — "takes 3.2s to replay on a new worker"
  - Worker memory — "this workflow consumes 180MB on the worker"
  - ContinueAsNew tracking — "last reset 3 days ago, 847 iterations since"
  - Workflow age — "this instance has been alive for 47 days"
  - Limit proximity alert — "at current growth, hits 50K event limit in 6 days"

D. Search & Discovery

- Cross-workflow search & filtering
  - Custom search attributes — index business data like customerId, region, orderAmount
  - Multi-criteria filtering — "status=FAILED AND function=payment AND time > 24h ago"
  - Step-level filtering — "find all workflows where step 'charge' failed"
  - Aggregation — "count by status", "group by error type"
  - Saved queries — reusable filters for common investigations
- Bulk operations
  - Bulk cancel/terminate — "cancel all 10,000 stuck workflows matching this query"
  - Bulk retry/resume — "restart all workflows that failed due to this error"
  - Bulk pause — "hold all workflows while we deploy a fix"
  - Rate limiting — don't overwhelm the system with 10K simultaneous cancels
  - Dry-run — "show me what would be affected" before executing

E. Business Outcomes & SLAs

- SLA compliance
  - End-to-end duration — business time from trigger to completion, not engine overhead
  - Completion rate — "98.2% succeed, 1.1% fail, 0.7% timeout"
  - Business-tagged metrics — duration by customer tier, region, product type
  - SLA breach alerting — "order processing exceeded 30-minute SLA"
  - Trend dashboards — are we getting better or worse over time?
- STP / automation rate
  - Automation percentage — "87% of claims processed without human intervention"
  - Exception tracking — which workflows fell out to manual handling and why
  - Fallout by step — "step 'verify-identity' causes 60% of manual fallouts"
  - STP trending — is automation rate improving or degrading?
  - Cost of intervention — time and money spent on manual exception handling
- Analytics & BI by business dimensions
  - Aggregate metrics — "avg duration of accepted claims: 4.2 days; rejected: 1.1 days"
  - Business dimension tags — slice by outcome, channel, region, tier
  - Cohort analysis — "claims from channel A take 2x longer than channel B"
  - Trend by dimension — "rejected claims getting faster, accepted getting slower"
  - Funnel analysis — "80% reach step 3, 60% reach step 5, 45% complete"
  - Distribution visualization — histograms showing duration clusters

F. Data Integrity & Correctness

- Output correctness validation
  - Output assertions — "step output must have >0 rows and amount > 0"
  - Previous run comparison — "output differs 90% from last successful run"
  - Anomaly detection — "usually returns 10K rows, today returned 3"
  - Business rule validation — "order total should never be negative"
  - Silent failure alerting — "step succeeded but returned empty array"
- Data freshness / staleness
  - Freshness per output — "customer_table last updated 3 hours ago"
  - Freshness SLAs — "this data must be refreshed every hour"
  - Upstream propagation — "stale because upstream dependency hasn't run"
  - Staleness alerting — "data exceeded 1-hour freshness threshold"
  - Freshness dashboard — at-a-glance view of fresh vs stale outputs
- Cross-party reconciliation
  - Match rate — "99.2% of transactions match between our system and payment provider"
  - Break records — specific mismatches with field-level detail
  - Field-level detail — "amount matches but date differs by 1 day"
  - Break aging — "47 unresolved mismatches, oldest is 5 days"
  - Reconciliation dashboard — matched vs unmatched vs in-progress
- Schema / contract drift
  - Schema versioning — track how input/output structure evolves over time
  - Contract validation — "input missing required field 'customer_id'"
  - Impact analysis — "API added field → these 12 workflows may be affected"
  - Compatibility checks — is new schema backward-compatible with existing code?
  - Schema change alerting — "upstream API schema changed since last run"
- Safety invariant monitoring
  - Continuous checking — validate constraints at every state transition, not just end
  - Proof of compliance — auditable evidence invariants held throughout execution
  - Degraded mode tracking — "system in safe-mode for 12 minutes due to constraint X"
  - Conflict detection — "two concurrent workflows would violate mutual exclusion"
  - Violation alerting — immediate notification, not end-of-day report

G. Lifecycle Management

- Version & deployment safety
  - Version tag — which code version is each execution running on
  - Version distribution — "v3: 12,000 running, v2: 847 draining, v1: 3 stuck"
  - Version filtering — find all workflows on a specific version
  - Replay compatibility — verify new code replays old histories correctly
  - Deployment safety — "342 in-flight workflows would break with this deploy"
  - Migration tracking — monitor old-version workflows draining to zero
- Missed schedule detection
  - Schedule history — did each scheduled slot produce a run?
  - Backfill tracking — which missed runs were backfilled, which are pending
  - Missed alerting — "2am cron didn't fire — no execution exists for that slot"
  - Schedule health dashboard — success/failure/missed rates per schedule
- Execution overlap / collision
  - Concurrent count — "3 instances of daily-report running simultaneously"
  - Collision impact — did overlap cause duplicate writes or corruption?
  - Overlap alerting — "new run started while previous still executing"
  - Prevention policies — skip, queue, or kill-previous on overlap
- Resource leak / orphaned holds
  - Hold registry — all temporary holds (seats, auths, locks) created by workflows
  - TTL tracking — when each hold was created and when it expires
  - Orphan detection — "payment auth from 3 hours ago never captured or voided"
  - Leak trending — are orphaned holds accumulating over time?
  - Cleanup alerting — "hold should have been released but wasn't"
- Desired vs actual convergence
  - Convergence rate — "7,342 of 10,000 devices updated (73.4%)"
  - Convergence time — "average 4.2 minutes from command to confirmed state"
  - Non-converged targets — "these 2,658 devices haven't applied the update"
  - Rollout progress — real-time percentage tracking
  - Divergence alerting — "desired ≠ actual for longer than 30-minute threshold"

H. External Integration & Export

- OTel / APM integration
  - Structured logs — every log line carries workflow ID for correlation
  - Replay-safe instrumentation — no duplicate logs/metrics during replay
  - CDC/streaming export — raw data to warehouses for custom analytics
  - OTel traces — span links (not parent-child) for async workflow causality
  - Metrics export — Prometheus/StatsD/OTLP for custom dashboards
  - Webhook hooks — call external URL on lifecycle events
- Real-time notifications / webhooks
  - Event streaming — subscribe to real-time stream of workflow events
  - Lifecycle webhooks — HTTP call on started/completed/failed/cancelled/stuck
  - Configurable channels — Slack, email, PagerDuty, custom webhook
  - Selective subscriptions — only notify for specific types or statuses
  - UI push — real-time dashboard updates without polling

I. Security, Compliance & Governance

- Audit trail
  - User attribution — "cancelled by user jane@company.com at 14:32 UTC"
  - Immutable history — tamper-proof record of every action and decision
  - Retention policies — keep audit data for required compliance periods
  - Export for auditors — extract records in standard formats
  - Access control — who can see workflow inputs/outputs (may contain PII)
- PII / sensitive data protection
  - Encryption at rest — codec/KMS for stored payloads
  - Selective visibility — show step names and timing, hide actual data
  - Payload redaction — auto-mask credit cards, SSNs, emails before storing
  - Role-based access — support sees status; engineers see everything
  - Configurable retention — auto-delete sensitive data after N days

J. Cost & Resource Attribution

- Cost / resource attribution
  - Per-workflow cost — "this execution used 12s compute, 3 API calls, 2MB storage"
  - Per-step cost — "charge step: 8s compute + 1 Stripe API call"
  - Token/API tracking — LLM token counts and costs for AI workflows
  - Cost trends — "this workflow type costs 40% more than last month"
  - Budget alerts — "payment-workflow exceeded $500/day threshold"

K. Dependency & Impact Analysis

- Blast radius / dependency mapping
  - Dependency map — "order-workflow calls: payment-api, inventory-api, notify-svc"
  - Parent-child tree — full hierarchy of workflow relationships
  - Impact analysis — "payment-api down → 500 workflows affected right now"
  - Cross-workflow correlation — group related workflows by business transaction
  - Proactive alerting — "inventory-api degrading → order-workflows will be affected"
  - Visualization — graphical dependency and impact tree
