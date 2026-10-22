# What Engineers Actually Ask For: Workflow Observability Requirements

## TL;DR

We analyzed observability needs across 25+ service types — from modern workflow-as-code platforms to mainframe batch processing, trading systems, IoT, and healthcare — and identified **35 distinct requirements** grouped into **12 themes**. The single most important finding: **no platform natively covers more than ~15 of these 35 requirements**. The remaining ~20 require custom instrumentation, external tooling, or simply don't exist yet. The biggest universal gaps are stuck workflow detection (P0), output correctness validation (P1), dependency-aware uptime (P1), and compute vs wait time breakdown (P1).

### How to read this document

1. **Themes** (next section) — 12 high-level groupings with one-sentence descriptions. Start here for orientation.
2. **Categories** (bulk of document) — 35 detailed requirements, each with the questions engineers ask, the real-world problem, and what teams need.
3. **Priority table** (near the end) — all 35 categories ranked P0–P3 with current platform support.
4. **Sources & research coverage** (end) — where the data came from and which service types were investigated.

### The 12 themes at a glance

| Theme                                    | Description                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| **A. Real-Time Operational Awareness**   | Is the system running, progressing, and keeping up with demand right now?            |
| **B. Failure Diagnosis**                 | Something broke — pinpoint the exact step, error, and root cause.                    |
| **C. Performance Analysis**              | Why is it slow, where's the bottleneck, and will it finish in time?                  |
| **D. Search & Discovery**                | Find specific workflows by criteria and act on them in bulk.                         |
| **E. Business Outcomes & SLAs**          | Are we meeting commitments, and what do the numbers look like by business dimension? |
| **F. Data Integrity & Correctness**      | The workflow "succeeded" — but was the result actually correct?                      |
| **G. Lifecycle Management**              | Is the workflow lifecycle itself working — versions, schedules, holds, convergence?  |
| **H. External Integration & Export**     | Connect workflow data to existing observability tools and notification channels.     |
| **I. Security, Compliance & Governance** | Who did what, when, and can we prove it without exposing sensitive data?             |
| **J. Cost & Resource Attribution**       | How much does each workflow cost in compute, API calls, and cloud spend?             |
| **K. Dependency & Impact Analysis**      | A service is down — which workflows are affected and what's the blast radius?        |
| **L. Domain-Specific**                   | Specialized needs from emerging use cases like AI agent workflows.                   |

## Platform Coverage Matrix

How well does each platform cover the 35 requirements? ✅ = native support, ⚠️ = partial/manual instrumentation required, ❌ = not supported.

Platforms: **Te** = Temporal, **Re** = Restate, **DB** = DBOS, **CF** = Cloudflare Workflows, **AW** = AWS Lambda Durable, **Az** = Azure Durable Functions

| #   | Requirement                                      | Te  | Re  | DB  | CF  | AW  | Az  |
| --- | ------------------------------------------------ | --- | --- | --- | --- | --- | --- |
|     | **Theme A: Real-Time Operational Awareness**     |     |     |     |     |     |     |
| 1   | Stuck workflow detection                         | ⚠️  | ⚠️  | ⚠️  | ❌  | ❌  | ❌  |
| 19  | Throughput & queue depth                         | ✅  | ❌  | ⚠️  | ❌  | ⚠️  | ⚠️  |
| 23  | Progress / ETA during execution                  | ⚠️  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 34  | Effective availability / dependency-aware uptime | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
|     | **Theme B: Failure Diagnosis**                   |     |     |     |     |     |     |
| 2   | Step-level error attribution                     | ⚠️  | ✅  | ✅  | ✅  | ❌  | ⚠️  |
| 5   | Specific workflow lookup & timeline              | ✅  | ✅  | ✅  | ✅  | ⚠️  | ✅  |
| 9   | Soft failures / retry tracking                   | ⚠️  | ⚠️  | ❌  | ✅  | ❌  | ❌  |
| 21  | Partial failure in parallel branches             | ⚠️  | ❌  | ❌  | ✅  | ❌  | ❌  |
| 17  | Replay / reproduce locally                       | ✅  | ⚠️  | ❌  | ❌  | ❌  | ❌  |
|     | **Theme C: Performance Analysis**                |     |     |     |     |     |     |
| 3   | Per-step duration tracking                       | ⚠️  | ❌  | ✅  | ✅  | ❌  | ⚠️  |
| 25  | Batch window / deadline forecast                 | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 33  | Compute vs wait time breakdown                   | ❌  | ❌  | ❌  | ⚠️  | ❌  | ❌  |
| 32  | Workflow internal health (history size)          | ✅  | ❌  | ❌  | ❌  | ⚠️  | ❌  |
|     | **Theme D: Search & Discovery**                  |     |     |     |     |     |     |
| 6   | Cross-workflow search & filtering                | ✅  | ✅  | ✅  | ⚠️  | ⚠️  | ⚠️  |
| 7   | Bulk operations                                  | ✅  | ❌  | ⚠️  | ❌  | ❌  | ❌  |
|     | **Theme E: Business Outcomes & SLAs**            |     |     |     |     |     |     |
| 4   | SLA breach alerting                              | ⚠️  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 26  | STP / automation rate                            | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 35  | Analytics / BI by business dimensions            | ❌  | ❌  | ⚠️  | ❌  | ❌  | ❌  |
|     | **Theme F: Data Integrity & Correctness**        |     |     |     |     |     |     |
| 20  | Output correctness validation                    | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 22  | Data freshness / staleness                       | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 27  | Cross-party reconciliation                       | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 28  | Schema / contract drift detection                | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 30  | Safety invariant monitoring                      | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
|     | **Theme G: Lifecycle Management**                |     |     |     |     |     |     |
| 11  | Version distribution visibility                  | ✅  | ❌  | ✅  | ⚠️  | ❌  | ❌  |
| 16  | Missed schedule detection                        | ❌  | ❌  | ⚠️  | ❌  | ❌  | ❌  |
| 24  | Execution overlap / collision detection          | ❌  | ❌  | ⚠️  | ❌  | ❌  | ❌  |
| 31  | Resource leak / orphaned hold detection          | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 29  | Desired vs actual state convergence              | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
|     | **Theme H: External Integration & Export**       |     |     |     |     |     |     |
| 8   | OTel / APM integration                           | ✅  | ✅  | ✅  | ❌  | ⚠️  | ✅  |
| 18  | Real-time notifications / webhooks               | ⚠️  | ❌  | ⚠️  | ✅  | ❌  | ❌  |
|     | **Theme I: Security, Compliance & Governance**   |     |     |     |     |     |     |
| 12  | Audit trail / compliance                         | ✅  | ⚠️  | ✅  | ❌  | ❌  | ⚠️  |
| 13  | PII redaction in observability                   | ✅  | ❌  | ❌  | ❌  | ❌  | ❌  |
|     | **Theme J: Cost & Resource Attribution**         |     |     |     |     |     |     |
| 15  | Cost / resource attribution                      | ❌  | ❌  | ❌  | ⚠️  | ⚠️  | ❌  |
|     | **Theme K: Dependency & Impact Analysis**        |     |     |     |     |     |     |
| 14  | Blast radius / dependency mapping                | ⚠️  | ❌  | ⚠️  | ❌  | ❌  | ❌  |
|     | **Theme L: Domain-Specific**                     |     |     |     |     |     |     |
| 10  | AI agent decision tracing                        | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |

### Coverage summary

| Platform               | ✅ Native | ⚠️ Partial | ❌ None | Coverage % (✅ + ⚠️) |
| ---------------------- | --------- | ---------- | ------- | -------------------- |
| **Temporal**           | 9         | 8          | 18      | 49%                  |
| **Restate**            | 4         | 3          | 28      | 20%                  |
| **DBOS**               | 5         | 7          | 23      | 34%                  |
| **Cloudflare**         | 5         | 3          | 27      | 23%                  |
| **AWS Lambda Durable** | 0         | 4          | 31      | 11%                  |
| **Azure Durable**      | 0         | 4          | 31      | 11%                  |

**Key takeaways:**

- **Theme F (Data Integrity)** is a universal blind spot — ❌ across all platforms, all 5 categories
- **Theme G (Lifecycle Management)** is almost entirely unsupported — only DBOS has partial coverage
- **Temporal** has the broadest coverage but still misses 18 of 35 requirements
- **AWS and Azure** managed platforms cover the least — simplicity comes at the cost of observability
- No platform covers **output correctness, safety invariants, dependency-aware uptime, or batch window forecasting**

---

## Categories by Theme

This document identifies 35 distinct observability requirements that engineers, operators, and business stakeholders ask for when running workflow-as-code systems in production. These requirements were gathered from 25+ service types — from modern workflow platforms (Temporal, Restate, DBOS, Cloudflare) to mainframe batch processing, trading systems, IoT, healthcare, and more.

The categories are grouped below into 12 themes based on the underlying observability concern they address. Many categories share similarities but differ in scope, audience, or timing (e.g., "why is it slow?" vs "will it finish before the deadline?" are both about performance, but one is diagnostic and the other is predictive).

Each category is detailed in the sections that follow, including the specific questions engineers ask, the real-world problem it addresses (with quotes from practitioners), and what teams actually need.

### Theme A: Real-Time Operational Awareness

_"What's happening right now and is it healthy?"_

| Cat | Name                        | Core Question                                    |
| --- | --------------------------- | ------------------------------------------------ |
| 1   | What's happening right now? | Are workflows stuck or progressing?              |
| 19  | Throughput & capacity       | Is the system keeping up with demand?            |
| 23  | Progress & ETA              | How far along is this long-running workflow?     |
| 34  | Effective availability      | What's our real uptime considering dependencies? |

### Theme B: Failure Diagnosis

_"Something went wrong — what, where, and why?"_

| Cat | Name                            | Core Question                                     |
| --- | ------------------------------- | ------------------------------------------------- |
| 2   | Why did it fail?                | Which step failed and what was the error?         |
| 5   | What happened to this workflow? | Full execution timeline for a specific instance   |
| 9   | Soft failures & degradation     | Retries increasing? Something degrading silently? |
| 21  | DAG execution path              | Which branch failed in a parallel workflow?       |
| 17  | Replay / reproduce locally      | Can I replay this failure in dev?                 |

### Theme C: Performance Analysis

_"Why is it slow and where's the bottleneck?"_

| Cat | Name                     | Core Question                                      |
| --- | ------------------------ | -------------------------------------------------- |
| 3   | Why is it slow?          | Which step is the bottleneck?                      |
| 25  | Batch window / deadline  | Will all jobs finish before the deadline?          |
| 33  | Compute vs wait time     | How much was actual compute vs suspended?          |
| 32  | Workflow internal health | Is history growing too large? Replay getting slow? |

### Theme D: Search & Discovery

_"Find workflows matching criteria X"_

| Cat | Name             | Core Question                             |
| --- | ---------------- | ----------------------------------------- |
| 6   | Find by criteria | All failed workflows for customer X?      |
| 7   | Bulk actions     | Cancel all 10,000 stuck workflows at once |

### Theme E: Business Outcomes & SLAs

_"Are we meeting our commitments?"_

| Cat | Name                  | Core Question                                         |
| --- | --------------------- | ----------------------------------------------------- |
| 4   | SLA compliance        | What percentage complete within SLA?                  |
| 26  | STP / automation rate | What percentage complete without manual intervention? |
| 35  | Analytics & BI        | Average duration grouped by business dimensions?      |

### Theme F: Data Integrity & Correctness

_"Did it produce the right result?"_

| Cat | Name                       | Core Question                                         |
| --- | -------------------------- | ----------------------------------------------------- |
| 20  | Output correctness         | Workflow succeeded but was the data right?            |
| 22  | Data freshness             | Is the output stale?                                  |
| 27  | Cross-party reconciliation | Does our record match the counterparty's?             |
| 28  | Schema / contract drift    | Did the input/output structure change unexpectedly?   |
| 30  | Safety invariants          | Was a hard constraint ever violated during execution? |

### Theme G: Lifecycle Management & Scheduling

_"Is the workflow lifecycle working correctly?"_

| Cat | Name                            | Core Question                                        |
| --- | ------------------------------- | ---------------------------------------------------- |
| 11  | Version & deployment safety     | Safe to deploy? How many on old version?             |
| 16  | Missed schedules                | Did the scheduled run actually fire?                 |
| 24  | Execution overlap               | Is the previous run still going when the next fires? |
| 31  | Resource leaks / orphaned holds | Did failed workflows leave unreleased resources?     |
| 29  | Desired vs actual convergence   | Did the target actually reach the desired state?     |

### Theme H: External Integration & Export

_"Connect workflow data to my tools"_

| Cat | Name                    | Core Question                           |
| --- | ----------------------- | --------------------------------------- |
| 8   | OTel / APM integration  | Get traces into Datadog/Grafana/Jaeger? |
| 18  | Real-time notifications | Webhook/Slack when something happens?   |

### Theme I: Security, Compliance & Governance

_"Who did what, and can we prove it?"_

| Cat | Name                 | Core Question                                |
| --- | -------------------- | -------------------------------------------- |
| 12  | Audit trail          | Who triggered/cancelled this and when?       |
| 13  | PII / sensitive data | How to debug without exposing customer data? |

### Theme J: Cost & Resource Attribution

_"How much does this cost?"_

| Cat | Name                        | Core Question                       |
| --- | --------------------------- | ----------------------------------- |
| 15  | Cost / resource attribution | Which workflows are most expensive? |

### Theme K: Dependency & Impact Analysis

_"What's the blast radius?"_

| Cat | Name         | Core Question                                     |
| --- | ------------ | ------------------------------------------------- |
| 14  | Blast radius | Service X is down — which workflows are affected? |

### Theme L: Domain-Specific

_"Specialized needs from specific use cases"_

| Cat | Name             | Core Question                      |
| --- | ---------------- | ---------------------------------- |
| 10  | AI agent tracing | What did the agent decide and why? |

---

## Category 1: "What's happening right now?"

### The Questions Engineers Ask:

- "How many workflows are currently running?"
- "Are any workflows stuck?"
- "What's the current queue depth / backlog?"
- "Is my system making progress or silently stalled?"

### The Real Problem:

> _"Workflow service can be healthy while your system is not. Workflows often stall in RUNNING state waiting on signals/timers/dependencies with no errors or latency spikes."_ — Xgrid production guide

A workflow sitting in RUNNING state for 7 hours with no errors, no latency spikes, and all dashboards green — while a customer's order hasn't moved. This is the most commonly reported observability gap.

### What They Need:

- **Real-time count of workflows by status** (running, queued, failed, stuck)
- **"Stuck" detection** — workflows in RUNNING state past expected duration with no progress
- **Queue depth monitoring** — how many workflows are waiting to be processed
- **Progress indicators** — not just "alive" but "making forward progress"

---

## Category 2: "Why did it fail?"

### The Questions Engineers Ask:

- "Which step failed?"
- "What was the error message?"
- "What were the inputs to the failed step?"
- "How many times did it retry before failing?"
- "What was the state of the workflow when it failed?"

### The Real Problem:

> _"A workflow that runs for hours or days can get 9 steps out of 10 and still leave a mess: half-created records, confusing status, and no clear next action."_ — Appmaster

Engineers need to pinpoint the exact step that failed, see the error, and understand the workflow's state at that moment — not just "workflow failed."

### What They Need:

- **Step-level error attribution** — which specific step failed and why
- **Error context** — inputs, outputs, and state at the point of failure
- **Retry history** — how many attempts, what errors on each attempt
- **Failure categorization** — transient vs permanent, infrastructure vs business logic
- **Stack traces** — for debugging code-level issues

---

## Category 3: "Why is it slow?"

### The Questions Engineers Ask:

- "Which step is the bottleneck?"
- "How long did each step take?"
- "Is this step slower than usual?"
- "What's the p50/p95/p99 duration for this step across all executions?"
- "Is the slowness getting worse over time?"

### The Real Problem:

> _"Workflow's execution duration metric measures internal overhead. It does not measure your business outcome time."_ — Xgrid

Platform-level metrics tell you the engine is healthy. They don't tell you that your payment step went from 200ms to 8 seconds because a downstream API is degrading.

### What They Need:

- **Per-step duration tracking** — start and end time for every step
- **Duration trends over time** — p50/p95/p99 per step, per workflow type
- **Anomaly detection** — "this step is 10x slower than its 7-day average"
- **Bottleneck identification** — which step contributes most to total workflow duration
- **Downstream dependency correlation** — slow step → slow external API

---

## Category 4: "Is my system meeting SLAs?"

### The Questions Engineers Ask:

- "What percentage of workflows complete within our SLA?"
- "How many workflows breached their deadline?"
- "Which workflow types have the worst completion rates?"
- "Alert me when SLA breach rate exceeds X%"

### The Real Problem:

> _"Observability is the backbone of identifying and resolving failures. It ensures that teams can meet their service level agreements (SLAs)."_ — Prefect

Business stakeholders care about outcomes, not infrastructure health. "All green" means nothing if 5% of orders are stuck.

### What They Need:

- **End-to-end workflow duration tracking** (business time, not engine time)
- **SLA breach detection and alerting** — workflow exceeded expected completion time
- **Completion rate by workflow type** — success/failure/timeout percentages
- **Trend dashboards** — are things getting better or worse?
- **Business-tagged metrics** — by customer tier, region, workflow type

---

## Category 5: "What happened to this specific workflow?"

### The Questions Engineers Ask:

- "A customer reported order #12345 is stuck — what's happening?"
- "Show me the full execution timeline for this workflow"
- "What steps completed? What's pending?"
- "Who/what triggered this workflow?"
- "What signals/events has it received?"

### The Real Problem:

> _"When a support ticket arrives about order 98765, the workflow ID is already known. Open the dashboard, paste order-98765, and the full execution timeline is in front of you in ten seconds. That single design decision — deterministic, readable workflow IDs — is the difference between a five-minute diagnosis and a twenty-minute one."_ — Xgrid

Support teams need to go from "customer complaint" to "here's exactly what happened" in seconds, not minutes.

### What They Need:

- **Lookup by business ID** — find workflow by order ID, customer ID, etc.
- **Full execution timeline** — every step, every wait, every retry, in order
- **Input/output visibility** — what data went in, what came out
- **Trigger source** — API call, cron, event, manual
- **Related workflows** — parent/child relationships, downstream effects
- **Query handlers** — ask the running workflow "what are you doing right now?"

---

## Category 6: "Find all workflows matching criteria X"

### The Questions Engineers Ask:

- "Show me all failed workflows in the last 24 hours"
- "Find all workflows for customer X"
- "Which workflows are stuck at the payment step?"
- "List all workflows that were triggered by this event"
- "How many workflows of type Y are currently running?"

### The Real Problem:

Most platforms only support basic filtering (status + time range). Engineers need to filter by business-specific criteria, step-level state, and custom attributes.

### What They Need:

- **Multi-criteria filtering** — status AND time AND name AND custom fields
- **Custom search attributes** — filter by business-specific data (customer ID, order amount, region)
- **Step-level filtering** — "find all workflows where step X failed" (very few platforms support this)
- **Aggregation** — count by status, by type, by error category
- **Saved queries / views** — reusable filters for common investigations

---

## Category 7: "Act on workflows in bulk"

### The Questions Engineers Ask:

- "Cancel all stuck workflows older than 24 hours"
- "Retry all workflows that failed due to this specific error"
- "Terminate all workflows for this deprecated version"
- "Pause all workflows while we deploy a fix"

### The Real Problem:

When an upstream service goes down and 10,000 workflows are stuck, you need to act on all of them at once — not one by one.

### What They Need:

- **Bulk cancel/terminate** — by query filter
- **Bulk retry/resume** — restart failed workflows matching criteria
- **Bulk pause** — hold workflows during maintenance
- **Rate-limited bulk operations** — don't overwhelm the system
- **Dry-run mode** — "show me what would be affected" before acting

---

## Category 8: "Connect workflow data to my existing tools"

### The Questions Engineers Ask:

- "How do I get workflow traces into Datadog/Grafana/Jaeger?"
- "Can I correlate workflow failures with infrastructure metrics?"
- "I need workflow data in our data warehouse for analytics"
- "How do I set up alerts in PagerDuty when workflows fail?"

### The Real Problem:

> _"Standard APM tracing breaks at async boundaries — use OpenTelemetry interceptors + span links to connect request → workflow → activities without lying about causality."_ — Xgrid

Workflows are asynchronous and long-running. Traditional request/response tracing doesn't work. The trace from the HTTP request that started the workflow ends at `workflow.start()` — everything the workflow does is orphaned in a disconnected trace tree.

### What They Need:

- **OpenTelemetry integration** — traces with proper span links (not parent-child) for async causality
- **Metrics export** — Prometheus/StatsD/OTLP for custom dashboards
- **Log aggregation** — structured logs with workflow ID correlation
- **Webhook/event hooks** — notify external systems on lifecycle events
- **CDC/streaming export** — raw data to data warehouses for analytics
- **Replay-safe instrumentation** — logs and metrics that don't duplicate on workflow replay

---

## Category 9: "Understand soft failures and degradation"

### The Questions Engineers Ask:

- "The workflow succeeded, but was the data correct?"
- "Are retries increasing? Something might be degrading"
- "The step succeeded on retry — but why did it fail the first time?"
- "Is this downstream service getting flaky?"

### The Real Problem:

> _"A gateway that starts returning TIMEOUT on 20% of auth attempts but succeeds on immediate retry looks perfectly healthy from Temporal's perspective — the activity is succeeding. The heartbeat payload surfacing a LastSoftError at a rising frequency is the degradation signal you can act on before it becomes a failure rate."_ — Xgrid

The most dangerous failures are the ones that don't look like failures. A step that retries 3 times and succeeds is "successful" — but the retry pattern is an early warning signal.

### What They Need:

- **Retry rate tracking** — per step, per workflow type, over time
- **Soft error categorization** — transient errors that were handled but indicate degradation
- **Success-with-retries vs clean-success distinction**
- **Downstream health inference** — "step X retry rate correlates with service Y latency"
- **Data quality validation** — workflow succeeded but output was wrong/incomplete

---

## Category 10: "AI Agent-Specific Observability" (Emerging)

### The Questions Engineers Ask:

- "What did the agent decide to do and why?"
- "Which tool did it call, with what inputs, and what happened?"
- "Why did the agent loop 15 times?"
- "How much did this agent run cost (tokens, API calls)?"
- "The agent returned a confident answer that was wrong — how do I trace that?"

### The Real Problem:

> _"Agents fail quietly. The agent completes its run, returns a response, and everything looks fine — until you realize it called the wrong tool three times, hallucinated a parameter value, and the task was never actually done."_ — The AI University

AI agents introduce non-deterministic behavior. Traditional "did it succeed or fail?" is insufficient — you need to understand the reasoning chain.

### What They Need:

- **Decision tracing** — why the agent chose this tool/action
- **Tool call logging** — inputs, outputs, latency for every tool invocation
- **LLM call tracking** — prompts, responses, token counts, latency, cost
- **Loop detection** — agent stuck in retry/reasoning loops
- **Human-in-the-loop tracking** — approval steps, escalations
- **Cost attribution** — per-run cost breakdown (tokens, API calls, compute)

---

## Category 11: "Which version is running and is it safe to deploy?"

### The Questions Engineers Ask:

- "How many workflows are still running on the old version?"
- "Is it safe to deploy a new version, or will it break in-flight workflows?"
- "Which workflows broke after the last deployment?"
- "Can I roll back without losing workflow state?"

### The Real Problem:

> _"Workflow versioning is often treated as a metadata concern when it should really be a correctness concern. Workflow definitions can change while executions are still in flight."_ — Orkes

Long-running workflows may run for days or weeks. Deploying new code while old workflows are mid-execution can cause replay failures, non-determinism errors, or silent data corruption.

### What They Need:

- **Version distribution visibility** — how many workflows are running on each code version
- **Deployment safety checks** — "are there in-flight workflows that would break with this deploy?"
- **Version-tagged filtering** — find all workflows running on version X
- **Replay compatibility testing** — verify new code can replay old workflow histories
- **Gradual migration tracking** — monitor old-version workflows draining before decommissioning

---

## Category 12: "Who did what and when?" (Audit & Compliance)

### The Questions Engineers Ask:

- "Who triggered this workflow?"
- "Who cancelled/terminated it and why?"
- "Show me a complete audit trail for this execution"
- "We need to prove this workflow ran correctly for compliance"
- "Can we demonstrate data lineage through this workflow?"

### The Real Problem:

> _"An audit trail is not a compliance accessory. It is what makes automation usable inside real companies. If an operator cannot answer what happened, why it happened, what evidence was used, and who approved it, the workflow will not survive contact with finance, security, legal, or leadership."_ — Grail

In regulated industries (healthcare, finance, government), workflow execution history is a compliance requirement, not a nice-to-have.

### What They Need:

- **User attribution** — who started, cancelled, resumed, or modified each workflow
- **Immutable execution history** — tamper-proof record of every step and decision
- **Retention policies** — keep audit data for required compliance periods
- **Export capabilities** — extract execution records for auditors
- **Access control on observability** — who can see workflow inputs/outputs (may contain PII)

---

## Category 13: "Protect sensitive data in observability"

### The Questions Engineers Ask:

- "Workflow inputs contain PII — how do I debug without exposing it?"
- "Can I redact credit card numbers from step outputs in the dashboard?"
- "Our compliance team says we can't store workflow payloads in the observability system"
- "How do I give support access to workflow status without exposing customer data?"

### The Real Problem:

> _"Debugging live systems without leaking sensitive data is not optional. PII leakage prevention in production debugging protects your users, your company, and your compliance posture."_ — Hoop.dev

Workflow inputs and outputs often contain customer data, payment info, or health records. Full observability conflicts with data protection requirements.

### What They Need:

- **Payload redaction/masking** — automatically mask PII in inputs/outputs before storing
- **Role-based observability access** — support sees status but not payloads; engineers see everything
- **Configurable data retention** — auto-delete sensitive data after N days
- **Codec/encryption support** — encrypt payloads at rest in the observability store
- **Selective visibility** — show step names and timing but hide step data

---

## Category 14: "What's the blast radius?" (Dependency & Impact Analysis)

### The Questions Engineers Ask:

- "This service is down — which workflows are affected?"
- "If I take down service X for maintenance, what will break?"
- "Show me all child workflows spawned by this parent"
- "Which workflows depend on this external API?"

### The Real Problem:

> _"When a database goes down, the ripple effects can be devastating — API failures, cache inconsistencies, queue backups, and cascading service degradation. Understanding the full blast radius of an incident is critical."_ — AutonomOps

Workflows orchestrate multiple services. When one dependency fails, you need to instantly understand which workflows are impacted.

### What They Need:

- **Dependency mapping** — which external services/APIs does each workflow type call
- **Impact analysis** — "service X is down → these 500 workflows are affected"
- **Parent-child visualization** — full tree of workflow relationships
- **Cross-workflow correlation** — group related workflows by business transaction
- **Proactive alerting** — "dependency X is degrading, these workflow types will be affected"

---

## Category 15: "How much does this cost?" (Cost & Resource Attribution)

### The Questions Engineers Ask:

- "How much compute does this workflow type consume?"
- "Which workflows are the most expensive to run?"
- "Our workflow costs doubled this month — which ones caused it?"
- "Can I set a budget/limit per workflow type?"

### The Real Problem:

> _"Workflow execution waste — compute spend driven by how inefficiently work executes — doesn't get its own line item on your bill, and it doesn't trigger anomaly alerts. It just sits inside your existing compute costs, looking normal."_ — Vantage

As workflow volume scales, cost attribution becomes critical. Without it, runaway workflows or inefficient steps silently inflate cloud bills.

### What They Need:

- **Per-workflow cost attribution** — compute time, API calls, storage used
- **Per-step cost breakdown** — which steps are most expensive
- **Cost trends** — is this workflow type getting more expensive over time
- **Budget alerts** — notify when a workflow type exceeds cost threshold
- **Token/API call tracking** — especially for AI agent workflows (LLM costs)

---

## Category 16: "Did the scheduled workflow actually run?"

### The Questions Engineers Ask:

- "Did the 2am cron workflow actually fire?"
- "How many scheduled runs were missed this week?"
- "The schedule says it ran, but did it complete successfully?"
- "We need to backfill missed runs — which ones were skipped?"

### The Real Problem:

> _"Cron doesn't care if your job succeeds or fails. It just runs the command and moves on. No alerts, no notifications, nothing."_ — OnlineOrNot

Scheduled workflows that silently fail to run are invisible. There's no error because nothing happened — the absence of an execution is the problem.

### What They Need:

- **Missed schedule detection** — alert when an expected run didn't happen
- **Schedule execution history** — did each scheduled slot produce a run?
- **Backfill tracking** — which missed runs were backfilled, which are still pending
- **Schedule health dashboard** — success/failure/missed rates per schedule

---

## Category 17: "Can I replay/reproduce this in dev?"

### The Questions Engineers Ask:

- "Can I replay this failed workflow locally to debug it?"
- "Give me the exact inputs so I can reproduce this"
- "Can I step through the execution history to see what happened?"
- "I need to test my fix against the real production execution history"

### The Real Problem:

Durable execution platforms record execution history for replay/recovery. But that same history is rarely exposed in a way that lets engineers reproduce issues locally.

### What They Need:

- **Export execution history** — download inputs, step outputs, and event history
- **Local replay** — re-run a production workflow's history against local code
- **Replay compatibility testing** — verify new code replays correctly against old histories
- **Step-through debugging** — walk through execution history step by step

---

## Category 18: "Tell me when something happens" (Real-Time Notifications)

### The Questions Engineers Ask:

- "Notify me on Slack when any workflow fails"
- "Call a webhook when this workflow completes"
- "Push real-time status updates to our UI"
- "Subscribe to lifecycle events for a specific workflow"

### The Real Problem:

Polling for status is wasteful and introduces latency. Engineers and systems need to be **pushed** updates when workflow state changes, not pull for them.

### What They Need:

- **Webhook on lifecycle events** — started, completed, failed, cancelled, stuck
- **Configurable notification channels** — Slack, email, PagerDuty, custom webhook
- **Event streaming** — subscribe to a real-time stream of workflow events
- **Selective subscriptions** — only notify for specific workflow types or statuses
- **UI push updates** — real-time status in dashboards without polling

---

## Category 19: "Is the system keeping up?" (Throughput & Capacity)

### The Questions Engineers Ask:

- "How many workflows per second are we processing?"
- "Is the queue growing faster than workers can drain it?"
- "Do we need to scale up workers?"
- "Are we hitting rate limits on downstream services?"
- "What's our headroom before we hit capacity?"

### The Real Problem:

> _"Monitoring task queues is a critical component of system observability that informs capacity planning, SLO adherence, and rapid incident response."_ — FlyRiver

Workflow platforms abstract away infrastructure, but someone still needs to know if the system is keeping up with demand.

### What They Need:

- **Throughput metrics** — workflows started/completed per second
- **Queue depth and wait time** — how long workflows sit before starting
- **Worker utilization** — are workers busy or idle
- **Concurrency tracking** — how many workflows running simultaneously
- **Capacity forecasting** — at current growth rate, when do we hit limits
- **Rate limit visibility** — are downstream rate limits causing backpressure

---

## Category 20: "It succeeded, but was the result correct?" (Output Validation)

### The Questions Engineers Ask:

- "The workflow completed successfully, but the data looks wrong"
- "Row counts dropped 90% but the pipeline reported success"
- "The API returned 200 OK with an empty body — the step 'succeeded' but did nothing"
- "How do I know the output is actually correct, not just error-free?"

### The Real Problem:

> _"The pipeline succeeded. The data was wrong. No one knew until a human noticed. This is the cost of monitoring pipeline execution without monitoring pipeline output."_ — DataLakehouse.help

> _"A pipeline that fails loudly is the best kind of problem. The dangerous pipeline is the one that succeeds silently while delivering wrong data."_ — Ryan Kirsch

Every workflow platform tracks **execution status** (running/succeeded/failed). None track **output correctness**. A step that returns an empty array is "successful." A workflow that processes 0 of 10,000 records is "complete." The status is green. The result is wrong.

### What They Need:

- **Output assertions** — validate step outputs against expected schemas, ranges, or counts
- **Anomaly detection on outputs** — "this step usually returns 10K rows, today it returned 3"
- **Business rule validation** — "order total should never be negative"
- **Comparison with previous runs** — "output differs significantly from last successful run"
- **Silent failure alerting** — detect when a step "succeeds" but produces empty/invalid results

---

## Category 21: "Which path did it take and what's the critical path?" (DAG Execution Path)

### The Questions Engineers Ask:

- "The workflow has 5 parallel branches — which one is the bottleneck?"
- "Some tasks succeeded but others failed — what's the partial completion state?"
- "What's the critical path through this workflow? Which steps determine total duration?"
- "A branch failed silently while other parallel branches completed — how do I catch that?"

### The Real Problem:

> _"The workflow may continue to downstream steps if the failed step was not declared a dependency. It may silently mark the step as failed while other parallel branches complete normally."_ — Waldium (Argo Workflows blind spots)

> _"Traditional observability practices often fall short when applied to parallel pipeline executions, leading to observability gaps that obscure root causes."_ — UMA Technology

Linear workflows are simple: step 1 → step 2 → step 3. But real workflows have parallel branches, conditional paths, fan-out/fan-in patterns, and dynamic task generation. When one branch of a parallel execution fails while others succeed, the workflow may report "partial success" or even "success" — hiding the failure.

### What They Need:

- **Execution path visualization** — which branches ran, which were skipped, which failed
- **Critical path analysis** — which sequence of steps determined total workflow duration
- **Partial failure detection** — alert when some parallel branches fail even if the workflow "succeeds"
- **Branch-level status** — per-branch success/failure in fan-out/fan-in patterns
- **Conditional path tracking** — which if/else branch was taken and why

---

## Category 22: "Is my data still fresh?" (Freshness & Staleness)

### The Questions Engineers Ask:

- "When was this data last updated by a workflow?"
- "Is the dashboard showing stale data because the pipeline hasn't run?"
- "Which downstream assets are stale because an upstream workflow failed?"
- "Alert me if this data is older than 1 hour"

### The Real Problem:

> _"Dagster+ helps you monitor the freshness, quality, and schema of your data. All assets now have a single health status that combines the status of the most recent materialization, freshness, and asset checks."_ — Dagster

This is distinct from "did the workflow run" (Category 16) and "was the output correct" (Category 20). Freshness is about **timeliness**: the workflow ran and succeeded, but the data it produced is now stale because it hasn't run again. Dagster pioneered this with freshness policies on assets.

### What They Need:

- **Freshness tracking per output** — when was each workflow output last updated
- **Freshness SLAs** — "this data must be refreshed every hour"
- **Staleness alerting** — notify when data exceeds freshness threshold
- **Upstream propagation** — "this asset is stale because its upstream dependency is stale"
- **Freshness dashboard** — at-a-glance view of which outputs are fresh vs stale

---

## Category 23: "How far along is it?" (Progress & ETA During Execution)

### The Questions Engineers Ask:

- "It's been running for 2 hours — is it 10% done or 90% done?"
- "What's the estimated time to completion?"
- "How many records has it processed so far out of the total?"
- "Is it making progress or just spinning?"

### The Real Problem:

> _"With an empty heartbeat payload, what you know is: the activity is alive. What you do not know is whether it is processing ten thousand records per minute or nine hundred, whether it is ten percent done or ninety."_ — Xgrid

> _"Displaying progress information during batch job execution is critical for long-running data processing operations. When processing thousands or millions of records, users need visibility into how far the job has progressed and how much longer it will take."_ — Spring Batch guide

This is distinct from stuck detection (Category 1 — binary "is it stuck?") and step duration (Category 3 — measured after completion). Progress tracking is about **real-time visibility into an in-flight step**: how much work has been done, how much remains, and when it will finish. For long-running workflows processing large datasets, this is the difference between "it's running" and "it's 73% done, ETA 45 minutes."

### What They Need:

- **Progress percentage** — how far through the current step/workflow
- **Throughput rate** — records/items processed per second/minute
- **ETA / estimated completion** — when will this finish
- **Items processed vs total** — 73,000 of 100,000 records
- **Progress history** — is throughput stable, increasing, or degrading
- **Structured heartbeat data** — not just "alive" but "alive and making progress at X rate"

---

## Category 24: "Is the previous run still going?" (Execution Overlap & Collision)

### The Questions Engineers Ask:

- "The cron fired again but the previous run hasn't finished — are they both running?"
- "Are two instances of the same workflow processing the same data simultaneously?"
- "Did the overlap cause duplicate records?"
- "How do I prevent concurrent runs of the same workflow?"

### The Real Problem:

> _"When cron schedules overlap, the problem is not 'two jobs ran.' It's that two jobs ran against the same data, at the same time, with no awareness of each other."_ — YiluProxy

> _"Execution overlaps are a common issue, occurring when a task takes longer to finish than the interval between its scheduled runs. This causes multiple instances of the same task to operate concurrently, potentially leading to resource clashes, data corruption, or unpredictable application behavior."_ — BigData Republic

This is distinct from missed schedules (Category 16 — the run didn't happen) and stuck detection (Category 1 — a single run is stuck). Overlap is about **two runs of the same workflow colliding** — both executing, both writing to the same resources, neither aware of the other.

### What They Need:

- **Overlap detection** — alert when a new run starts while the previous is still executing
- **Concurrent execution visibility** — how many instances of the same workflow are running simultaneously
- **Overlap prevention policies** — skip, queue, or kill-previous when overlap detected
- **Collision impact tracking** — did the overlap cause duplicate writes or data corruption

---

## Category 25: "Will everything finish in time?" (Batch Window / Processing Deadline)

### The Questions Engineers Ask:

- "Will all nightly jobs complete before the business day starts at 6am?"
- "We're 3 hours into a 4-hour batch window and only 60% done — will we make it?"
- "Which job in the chain is the one that's going to blow the window?"
- "If this job reruns, does the whole batch window still fit?"

### The Real Problem:

> _"Batch jobs often must complete within a batch window, a period of less-intensive online activity, as prescribed by a service level agreement (SLA)."_ — IBM z/OS documentation

> _"DRT (Daily Run Time) refers to the cumulative time required for mission-critical scheduled processes to execute successfully before the next business cycle begins."_ — FlyRiver

This is a concept mainframes have tracked for decades that modern workflow platforms largely ignore. It's distinct from per-workflow SLA (Category 4) because it's a **shared deadline across a group of workflows**. The question isn't "will this one workflow finish on time?" but "will ALL the workflows in this processing window finish before the deadline?" A single slow job can blow the window for everything downstream.

### What They Need:

- **Window completion forecast** — given current progress, will all jobs finish before the deadline?
- **Critical chain identification** — which sequence of dependent jobs determines the window end time?
- **Window utilization trending** — is the batch window getting tighter over time? (growing data volumes)
- **Rerun impact analysis** — if this job needs to rerun, does the window still fit?
- **Window breach alerting** — early warning when the window is at risk, not just when it's already blown

---

## Category 26: "What percentage went straight through?" (Automation / STP Rate)

### The Questions Engineers Ask:

- "What percentage of workflows completed without any manual intervention?"
- "How many workflows hit the exception queue and needed human repair?"
- "Is our automation rate improving or degrading over time?"
- "Which step causes the most fallouts to manual processing?"

### The Real Problem:

> _"The average global straight-through processing rate is just 26% for cross-border payments."_ — Wise

> _"Straight-through processing is an aspirational methodology in which the processing of transactions is completed, end-to-end, without the need for human intervention."_ — IBM

In trading and financial services, the **STP rate** (Straight-Through Processing rate) is the single most important operational metric: what percentage of transactions flow from start to finish without a human touching them? Every manual intervention is cost, delay, and risk. This concept applies broadly to any workflow system — what's your automation rate, and where do workflows "fall out" to manual handling?

### What They Need:

- **STP / automation rate** — percentage of workflows completing without manual intervention
- **Exception/fallout tracking** — which workflows needed human repair and why
- **Fallout by step** — which step causes the most manual interventions
- **STP rate trending** — is automation improving or degrading over time
- **Cost of manual intervention** — time and money spent on exception handling

---

## Category 27: "Do both sides agree?" (Cross-Party Reconciliation)

### The Questions Engineers Ask:

- "Does our record match the counterparty's record?"
- "How many trades are unmatched / broken?"
- "Which fields are mismatching — amount, date, reference?"
- "How long have these breaks been outstanding?"

### The Real Problem:

> _"Every morning, operations teams across buy-side firms, custodians, and brokers start their day scanning for settlement breaks, mismatches, and failing trades."_ — Ionixx

> _"Trade 'breaks' — mismatches in trade details — occur due to data entry errors, system latency, counterparty discrepancies, or market anomalies."_ — Corvair

When a workflow interacts with external parties (payment processors, APIs, counterparties, partner systems), the workflow's view of what happened may not match the external party's view. This is the **reconciliation problem** — and it's distinct from output correctness (Category 20, which is about internal validation). Reconciliation is about **cross-system agreement**: do both sides see the same thing?

### What They Need:

- **Match rate monitoring** — what percentage of transactions match across systems
- **Break/mismatch detection** — identify discrepancies between internal and external records
- **Break aging** — how long have unresolved mismatches been outstanding
- **Field-level mismatch detail** — which specific fields don't agree
- **Reconciliation dashboard** — at-a-glance view of matched vs unmatched vs in-progress

---

## Category 28: "Did the shape of the data change?" (Schema & Contract Drift)

### The Questions Engineers Ask:

- "An upstream API added a new field — did that break anything?"
- "A column was removed from the source table — which workflows are affected?"
- "The data type changed from string to integer — why are workflows silently producing nulls?"
- "Did the input schema match what the workflow expected?"

### The Real Problem:

> _"Data observability tracks five key dimensions: freshness, volume, schema, distribution, and lineage."_ — CDP.com

> _"Traditional ETL pipelines are brittle by design: they assume source schemas are stable, data arrives on schedule, and nothing changes without notice."_ — Contra Collective

This is distinct from output correctness (Category 20 — "was the result right?") and failure detection (Category 2 — "which step failed?"). Schema drift is about the **structure of inputs or outputs changing unexpectedly** — a new column appears, a field is removed, a type changes. The workflow may still "succeed" but produce garbage because it's processing data shaped differently than expected. In ETL, this is one of the most common causes of silent data corruption.

### What They Need:

- **Schema change detection** — alert when input/output schema differs from expected
- **Schema versioning** — track schema evolution over time
- **Contract validation** — verify inputs match a declared schema/contract before processing
- **Impact analysis** — "this schema changed → these workflows and downstream consumers are affected"
- **Backward compatibility checks** — is the new schema compatible with existing workflow code

---

## Category 29: "Did the target actually reach the desired state?" (Desired vs Actual Convergence)

### The Questions Engineers Ask:

- "I sent a config update to 10,000 devices — how many have actually applied it?"
- "The workflow set the desired state to 'active' — but the system still reports 'pending'"
- "How long has the gap between desired and actual state been open?"
- "Which targets haven't converged yet, and why?"

### The Real Problem:

> _"A device twin acts as a cloud-based representation of a physical device. The desired state says what you want; the reported state says what the device actually is."_ — Azure IoT Hub documentation

> _"Never update the whole fleet at once."_ — SumatoSoft on IoT update management

In IoT, the "device twin" pattern tracks **desired state** (what you told the device to be) vs **reported state** (what the device says it actually is). The gap between them — and how long it persists — is a critical observability signal. This applies broadly to any workflow that sends commands to external systems: deployment rollouts, configuration changes, feature flag updates, infrastructure provisioning. The workflow "succeeded" (it sent the command), but did the target actually converge to the desired state?

### What They Need:

- **Convergence rate** — what percentage of targets have reached desired state
- **Convergence time** — how long between command sent and state confirmed
- **Non-converged target identification** — which specific targets haven't applied the change
- **Divergence alerting** — alert when desired ≠ actual for longer than threshold
- **Rollout progress tracking** — 7,342 of 10,000 devices updated (73.4%)

---

## Category 30: "Was a safety invariant ever violated?" (Safety & Invariant Monitoring)

### The Questions Engineers Ask:

- "Did the system ever enter an unsafe state, even momentarily?"
- "Were two conflicting signals ever green at the same time?"
- "Did the workflow ever process a transaction that violated a business rule?"
- "Prove that constraint X was never violated during this execution"

### The Real Problem:

> _"Signalling systems are designed to be fail-safe, meaning any failure will result in a safe reaction by defaulting to the lowest energy state."_ — Railway signaling principles

> _"Fail-safe defaults ensure that when something unexpected happens, the system falls into a known-safe state rather than an open, permissive, or undefined one."_ — arc42 Quality Model

In traffic lights, two conflicting green signals = collision. In railway interlocking, two trains in the same block section = disaster. In financial systems, a negative balance or double-spend = regulatory violation. These are **invariants that must never be violated**, not even for a millisecond. This is fundamentally different from output correctness (checked after completion) — safety invariant monitoring must be **continuous during execution** and violations must be detected and acted on immediately.

This applies to any workflow with hard constraints: financial limits, compliance rules, resource caps, mutual exclusion, ordering guarantees.

### What They Need:

- **Continuous invariant checking** — validate constraints at every state transition, not just at completion
- **Invariant violation alerting** — immediate notification when a constraint is breached
- **Proof of compliance** — auditable evidence that invariants were maintained throughout execution
- **Degraded mode tracking** — when the system enters a reduced-capability safe state, track why and for how long
- **Conflict detection** — identify when two concurrent workflows would violate a mutual exclusion constraint

---

## Category 31: "Are there leaked resources from failed workflows?" (Resource Leak / Orphaned Holds)

### The Questions Engineers Ask:

- "A booking workflow failed mid-way — is the seat still held or was it released?"
- "How many payment authorizations are dangling without a corresponding capture or void?"
- "Are there temporary locks that were never released because the workflow crashed?"
- "How much inventory is tied up in expired-but-unreleased holds?"

### The Real Problem:

> _"When you select a seat, a lock is acquired for ~5 minutes. Payment completes the booking; timeout releases the seat."_ — Ajit Singh on ticket booking system design

> _"Credit card payments succeed but reservations fail to generate. Your customers are left stranded with charged cards but no confirmed travel arrangements."_ — ODown on travel platform reliability

When a workflow creates a **temporary resource hold** (seat reservation, payment auth, inventory lock, database lock, cloud resource) and then fails, times out, or crashes before completing or cleaning up, the resource is "leaked." It's neither used nor freed. Over time, these orphaned holds accumulate: seats appear sold but aren't, payment auths expire and confuse reconciliation, inventory shows unavailable but nobody has it.

This is distinct from:

- Category 2 (why did it fail) — the workflow failure is known; the leaked resource is the hidden side effect
- Category 9 (soft failures) — the workflow may have "succeeded" from its perspective while leaving a dangling hold
- Category 14 (blast radius) — this is about resources held by the workflow, not downstream services affected

### What They Need:

- **Orphaned resource detection** — find holds/locks/auths that outlived their workflow
- **TTL monitoring** — track temporary holds approaching or past their expiry
- **Cleanup verification** — confirm that failed workflow compensations actually released resources
- **Resource leak trending** — are orphaned holds accumulating over time?
- **Automatic cleanup alerting** — notify when a hold should have been released but wasn't

---

## Category 32: "Is the workflow itself healthy?" (Workflow Internal Health)

### The Questions Engineers Ask:

- "How large is this workflow's event history? Is it approaching the limit?"
- "How many iterations has this long-running scheduler workflow completed?"
- "Is the workflow consuming too much memory on the worker?"
- "When was the last `continueAsNew` — is the history getting dangerously large?"
- "How long does replay take for this workflow? Is it getting slower?"

### The Real Problem:

> _"My current workflows tend to have long lifespans. Therefore, I intend to use the continue-as-new pattern, but considering the various approaches, I am unsure about what guidelines I should follow."_ — Temporal community (scaling 400M workflows)

When a workflow IS the scheduler (a long-running sleep loop that fires work periodically), the workflow itself becomes a long-lived resource that can degrade over time. Event history grows with every iteration. Replay time increases. Memory usage on workers climbs. Eventually the workflow hits platform limits (Temporal's 50K event history limit) and is forcibly terminated — silently killing your "scheduler."

This is distinct from:

- Category 15 (cost/resource attribution) — that's about external compute cost, not internal workflow engine resources
- Category 19 (throughput/capacity) — that's about system-wide capacity, not per-workflow health
- Category 1 (stuck detection) — the workflow isn't stuck, it's running but degrading

### What They Need:

- **Event history size monitoring** — how many events, approaching limits?
- **Replay duration tracking** — how long does it take to replay this workflow on a new worker?
- **Worker memory per workflow** — is this workflow consuming disproportionate resources?
- **ContinueAsNew tracking** — when was the last reset? How many iterations since?
- **Workflow age monitoring** — how long has this workflow instance been alive?
- **Platform limit proximity alerts** — warn before hitting history size, timeout, or retention limits

---

## Category 33: "How much was compute vs waiting?" (Compute Lifecycle & Resume Latency)

### The Questions Engineers Ask:

- "This workflow ran for 4 hours — but how much was actual compute vs suspended/waiting?"
- "How long does it take to resume after a callback arrives?"
- "What's the replay/rehydration overhead when the workflow wakes up?"
- "Are we paying for wait time or only compute time? How do I verify?"
- "Which steps have the worst resume latency?"

### The Real Problem:

> _"Every durable execution system adds some latency between steps. It's the tax we pay for reliability. Persist the state, enqueue the next step, check constraints, dispatch."_ — Inngest

> _"Do Your Lambdas Cost You More to Wait Than to Compute? We believe a serverless platform should only charge you for the CPU time your app actually uses, not for the total wall-clock time."_ — DBOS

Durable execution workflows have a unique compute pattern: they alternate between **active compute** (running step code) and **suspended/idle** (waiting for timers, callbacks, child workflows, signals). The wall-clock duration of a workflow tells you almost nothing about its actual resource consumption. A workflow that runs for 30 days may only use 45 seconds of compute.

This creates observability needs that don't exist in traditional services:

- **Compute vs wait ratio** — what percentage of wall-clock time was actual compute?
- **Resume latency** — when a wait completes, how long until the workflow is actually running again? (includes replay, rehydration, worker scheduling)
- **Suspend/resume count** — how many times did this workflow suspend and resume?
- **Cost accuracy** — am I being charged for wait time or only compute time?

### What They Need:

- **Compute time vs wall-clock time breakdown** — per workflow and per step
- **Resume latency tracking** — time from "event received" to "code executing" after each suspend
- **Replay/rehydration overhead** — how much of resume time is spent replaying history vs executing new code
- **Suspend/resume frequency** — how often does this workflow cycle between active and idle
- **Idle cost verification** — confirm you're not paying for suspended time on pay-per-compute platforms

---

## Category 34: "What's our actual workflow uptime?" (Effective Availability & Dependency-Aware Uptime)

### The Questions Engineers Ask:

- "The workflow engine is fine, but workflows keep failing because the payment service is down — what's our real uptime?"
- "This workflow depends on 5 services — what's our compounded availability?"
- "We promised 99.9% SLA to customers — but our downstream dependency only offers 99.5%"
- "Workflow failures spiked last Tuesday — was it our code or a dependency outage?"
- "Which dependency is the biggest contributor to our workflow downtime?"

### The Real Problem:

A workflow's **effective availability** is not the workflow engine's uptime. It's the intersection of every dependency's availability. If your workflow calls a payment API (99.9%), a shipping API (99.5%), and a notification service (99.8%), your workflow's theoretical max availability is ~98.2% — even if your own code and infrastructure are perfect.

Most teams discover this the hard way: the workflow engine dashboard shows 100% uptime, but customers report 2% of orders failing. The failures are all caused by downstream services, but nobody tracks the **workflow's effective uptime** as a composite metric.

### What They Need:

- **Effective workflow availability** — success rate of this workflow type over time (not engine uptime, but actual completion rate)
- **Dependency-aware uptime** — map each workflow type to its dependencies and compute composite availability
- **Downtime attribution** — "47 minutes of workflow downtime this month: 30 min from payment API, 12 min from shipping API, 5 min from our code"
- **Dependency health impact** — "payment API degradation caused 342 workflow failures today"
- **SLA composition** — "given our dependencies' published SLAs, the best we can promise is 98.5%"
- **Availability trending** — is our effective uptime improving or degrading month over month?

---

## Category 35: "What are the patterns across executions?" (Workflow Analytics & Business Intelligence)

### The Questions Engineers Ask:

- "What's the average duration of insurance claims grouped by outcome (accepted, rejected, escalated)?"
- "How does workflow duration vary by customer tier / region / product type?"
- "What percentage of orders go through the expedited path vs the standard path?"
- "Which workflow variant has the highest failure rate?"
- "Show me a histogram of workflow durations — are there distinct clusters?"

### The Real Problem:

Operational observability (Categories 1-4) answers "is this workflow healthy right now?" Business intelligence answers "what are the patterns across thousands of executions over time?" These are fundamentally different questions requiring different data models.

No workflow platform provides aggregate analytics grouped by business dimensions out of the box. You can filter by status and time range, but you can't ask "average duration of completed workflows grouped by claim_type where region = 'EU'" without building a custom analytics pipeline.

### What They Need:

- **Aggregate duration metrics** — average, median, p95, p99 grouped by workflow type, outcome, or custom dimensions
- **Business dimension grouping** — slice metrics by customer tier, region, product type, outcome, or any business attribute
- **Cohort analysis** — compare performance across different groups (e.g., "claims from channel A take 2x longer than channel B")
- **Distribution visualization** — histograms, percentile curves, not just averages
- **Trend analysis by dimension** — "rejected claims are getting faster but accepted claims are getting slower — why?"
- **Funnel analysis** — what percentage of workflows reach each stage, and where do they drop off?

---

## Summary: Priority-Ranked Requirements

Based on frequency and severity across all sources:

| Priority | Cat | Requirement                                               | Who Asks                             | Current Platform Support                                                                    |
| -------- | --- | --------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| **P0**   | 1   | Stuck workflow detection                                  | On-call engineers                    | Poor — most platforms don't detect "running but not progressing"                            |
| **P0**   | 2   | Step-level error attribution                              | All engineers                        | Mixed — Cloudflare/DBOS good, Temporal/AWS poor without instrumentation                     |
| **P0**   | 5   | Lookup by business ID                                     | Support teams                        | Only Temporal (custom search attrs) and DBOS (direct SQL)                                   |
| **P0**   | 30  | Safety invariant / constraint violation detection         | Safety / compliance / SRE teams      | No workflow platform provides continuous invariant monitoring during execution              |
| **P1**   | 3   | Per-step duration tracking                                | Performance engineers                | DBOS and Cloudflare automatic; others require instrumentation                               |
| **P1**   | 4   | SLA breach alerting                                       | Business stakeholders                | No platform provides this natively — always requires custom metrics                         |
| **P1**   | 7   | Bulk operations                                           | Incident responders                  | Only Temporal supports query-based bulk operations                                          |
| **P1**   | 8   | OTel/APM integration                                      | Platform engineers                   | Temporal (interceptors), Restate (auto), DBOS (integration)                                 |
| **P1**   | 11  | Version distribution visibility                           | Release engineers                    | DBOS (app_version column), Temporal (BuildIds search attr); others limited                  |
| **P1**   | 14  | Dependency / blast radius analysis                        | SRE teams                            | No platform provides this natively                                                          |
| **P1**   | 16  | Missed schedule detection                                 | On-call / data engineers             | DBOS (schedule tables); most platforms don't track missed runs                              |
| **P1**   | 18  | Real-time notifications / webhooks                        | All engineers                        | Cloudflare (events API); Temporal (no native); most require polling                         |
| **P1**   | 19  | Throughput & queue depth monitoring                       | SRE / platform teams                 | Temporal (SDK metrics); others limited or require custom metrics                            |
| **P1**   | 20  | Output correctness validation                             | Data / all engineers                 | No platform provides this — all track execution status, none track output correctness       |
| **P1**   | 21  | Partial failure in parallel branches                      | All engineers                        | Cloudflare (step-level status); most platforms report only overall workflow status          |
| **P1**   | 23  | Progress / ETA during execution                           | All engineers                        | Temporal (heartbeat payloads — manual); no platform provides automatic progress tracking    |
| **P1**   | 24  | Execution overlap / collision detection                   | Data / SRE teams                     | DBOS (deduplication_id); most platforms have no overlap detection                           |
| **P1**   | 25  | Batch window / processing deadline forecast               | SRE / operations teams               | Mainframe schedulers (TWS, CA-7, Control-M); no modern workflow platform provides this      |
| **P1**   | 31  | Resource leak / orphaned hold detection                   | Operations / SRE teams               | No workflow platform tracks resources created but not cleaned up by failed workflows        |
| **P1**   | 32  | Workflow internal health (history size, replay time)      | Platform / SRE teams                 | Temporal (HistoryLength, HistorySizeBytes search attrs); others have no visibility          |
| **P1**   | 33  | Compute vs wait time breakdown / resume latency           | Platform / finance teams             | No platform provides this — all report wall-clock duration, none break down compute vs idle |
| **P1**   | 34  | Effective workflow availability / dependency-aware uptime | SRE / business teams                 | No platform provides this — all track engine uptime, none track composite availability      |
| **P2**   | 6   | Cross-workflow search & filtering                         | Analytics teams                      | Temporal (SQL-like query), Restate (SQL JOIN), DBOS (direct SQL); others basic filters only |
| **P2**   | 9   | Retry rate / soft error tracking                          | SRE teams                            | Cloudflare (attempts array); others require custom instrumentation                          |
| **P2**   | 12  | Audit trail / compliance                                  | Compliance teams                     | DBOS (Postgres audit), Temporal (event history); others limited                             |
| **P2**   | 13  | PII redaction in observability                            | Security / compliance                | Temporal (Payload Codec); others have no built-in support                                   |
| **P2**   | 15  | Cost / resource attribution                               | Engineering managers                 | No platform provides this natively                                                          |
| **P2**   | 17  | Replay / reproduce locally                                | All engineers                        | Temporal (replay testing); others have no local replay support                              |
| **P2**   | 22  | Data freshness / staleness tracking                       | Data engineers                       | Dagster (freshness policies); no workflow-as-code platform provides this                    |
| **P2**   | 26  | STP / automation rate tracking                            | Operations / business teams          | No workflow platform tracks this — always requires custom metrics                           |
| **P2**   | 27  | Cross-party reconciliation / match rate                   | Operations / finance teams           | No workflow platform provides this — domain-specific tooling required                       |
| **P2**   | 28  | Schema / contract drift detection                         | Data / platform engineers            | No workflow platform provides this — ETL tools (dbt, Great Expectations) handle separately  |
| **P2**   | 29  | Desired vs actual state convergence                       | IoT / platform / SRE teams           | IoT platforms (Azure IoT Hub device twins); no workflow-as-code platform tracks this        |
| **P2**   | 35  | Workflow analytics / BI by business dimensions            | Business / product / analytics teams | No platform provides this natively — requires external analytics (Strategy B/C)             |
| **P3**   | 10  | AI agent decision tracing                                 | AI/ML engineers                      | No workflow platform provides this — requires specialized tools                             |
| **P3**   | 25b | Critical path analysis                                    | Performance engineers                | No platform provides this natively                                                          |

## Sources

This document synthesizes requirements from:

- Temporal community forums and production incident reports
- Prefect blog on workflow observability best practices
- Xgrid's "Temporal Observability in Production" guide (real production experience)
- SigNoz deep Temporal observability analysis
- AI agent observability guides (Braintrust, Maxim AI, Neuronex, The AI University)
- FlowWright on workflow observability beyond basic monitoring
- Appmaster on long-running workflow visibility
- GitHub Actions monitoring discussions
- Orkes/Conductor on workflow versioning and backward compatibility
- Grail on AI workflow audit trails
- Hoop.dev on PII redaction in production debugging
- DataLakehouse.help on pipeline output correctness ("the pipeline succeeded, the data was wrong")
- Ryan Kirsch on data observability and silent pipeline failures
- Waldium on Argo Workflows monitoring blind spots (partial failure in parallel branches)
- Dagster documentation on asset freshness policies and health monitoring
- Astronomer on Airflow DAG SLAs and dependency monitoring
- Orchestra on Airflow task dependency troubleshooting
- OnlineOrNot / Crontify on missed cron schedule detection
- Vantage on workflow execution cost and cloud spend
- AutonomOps on blast radius and incident impact analysis
- Multiple practitioner blog posts and community discussions
- OneUpTime on job checkpointing for long-running batch processes
- Spring Batch / CopyProgramming on progress tracking during batch execution
- Temporal community on batch processing best practices and heartbeat payloads
- IBM z/OS documentation on batch windows and processing deadlines
- BMC on mainframe system monitoring and observability
- Broadcom CA Workload Automation on restart point determination
- Planet Mainframe on batch challenges and solutions
- Wise / IBM on straight-through processing (STP) rates in financial services
- Ionixx / Corvair on post-trade settlement breaks and reconciliation
- TechStory on observability for high-volume financial systems
- Finantrix on trade confirmation and matching platforms
- Data observability "five pillars" (CDP.com, Dawiso, Actian, Conduktor) — freshness, volume, schema, distribution, lineage
- Ryan Kirsch on data observability and volume anomaly detection
- DQOps on schema change detection in data pipelines
- Azure IoT Hub documentation on device twins (desired vs reported state)
- Golioth on desired state vs actual state design patterns
- Memfault / Bosch IoT Rollouts on fleet-wide rollout monitoring
- Railway signaling principles on fail-safe design and interlocking
- arc42 Quality Model on fail-safe defaults
- Risknowlogy on graceful degradation in safety systems (IEC 61508)
- Ajit Singh on ticket booking system design (seat locks, TTL, race conditions)
- ODown on travel platform reliability (payment succeeded but reservation failed)
- BugFree.ai on airline reservation state modeling
- Inngest on eliminating latency between durable execution steps
- DBOS blog on Lambda hidden wait costs (compute vs wall-clock billing)
- Temporal community on replay overhead and continueAsNew scaling

## Research Coverage

### Service types investigated ✅

- Workflow-as-code platforms (Temporal, Restate, DBOS, Cloudflare, AWS Lambda Durable, Azure Durable, Vercel)
- DAG orchestrators (Airflow, Dagster, Prefect, Argo Workflows)
- Long-running batch jobs and background tasks
- CI/CD pipelines (GitHub Actions, Jenkins)
- Microservice orchestration / sagas
- AI agent workflows (multi-step, tool-calling, LLM-based)
- Serverless functions (Lambda, Cloudflare Workers)
- State machines (AWS Step Functions) — mapped to Category 21 (execution path)
- Message queue consumers (Kafka, SQS) — mapped to Categories 1, 2, 19 (stuck, failure, throughput)
- Payment/transaction processing (Stripe, sagas) — mapped to Categories 12, 20 (audit, output correctness)
- ML training pipelines (SageMaker, MLflow) — mapped to Categories 3, 23 (slow, progress/ETA)
- IoT device command pipelines — mapped to Categories 1, 11, 18 (stuck, versioning, notifications)
- IoT fleet management & device twins (deeper investigation) — found Category 29 (desired vs actual convergence); fleet rollout mapped to Category 23 (progress/ETA)
- Scheduled/cron services — found Category 24 (execution overlap); rest mapped to Category 16 (missed schedules)
- API gateway / request orchestration — mapped to Categories 9, 21 (degradation, partial failure)
- Database migrations — mapped to Categories 3, 23 (slow, progress/ETA)
- Approval/ticketing systems — mapped to Categories 1, 4 (stuck, SLA)
- Mainframe batch processing (JCL, JES, CICS, TWS, CA-7) — found Category 25 (batch window); rest mapped to existing categories
- Trading systems (pre-trade, post-trade, settlement) — found Categories 26 (STP rate) and 27 (reconciliation)
- ETL / data pipelines (five pillars of data observability) — found Category 28 (schema drift); rest mapped to Categories 20, 22 (output correctness, freshness)
- Real-time / event-driven services (stream processing, latency budgets) — mapped to Categories 3, 4, 19, 20 (slow, SLA, throughput, output correctness)
- Multimedia / media processing (transcoding, image processing, speech-to-text) — mapped to Categories 3, 15, 19, 20, 21, 23 (slow, cost, throughput, output quality, parallel variants, progress)
- Traffic control & railway signaling (safety-critical systems) — found Category 30 (safety invariant monitoring); fail-safe/degraded mode concepts
- Ticketing / booking systems (airline, hotel, event) — found Category 31 (resource leak / orphaned holds); double-booking mapped to Category 30, partial booking to Category 21
- Healthcare / clinical systems (lab results, medication admin, patient handoffs) — mapped to Categories 4, 12, 18, 30 (SLA, audit trail, notifications, safety invariants)
- Workflow-as-scheduler pattern (sleep loops, continueAsNew) — found Category 32 (workflow internal health); iteration tracking mapped to Category 23
- Workflow compute lifecycle (suspend/resume, pay-per-compute) — found Category 33 (compute vs wait time, resume latency)

### Service types not yet investigated

- (none remaining)

### Platform roadmaps reviewed (no new categories found, validates existing ones)

- **Cloudflare**: CPU time metrics (validates Cat 33), agentic era rearchitecture
- **Restate**: Graphical UI, pause/resume/restart from journal point (validates Cat 17), SOC 2/RBAC/HIPAA (validates Cat 12)
- **Temporal**: Nexus cross-namespace (validates Cat 14), Worker health (validates Cat 19), Workflow Rules (validates Cat 18)
- **DBOS**: Configurable alerting in Conductor (validates Cat 18), MCP server for AI agents, Conductor dashboards
- **AWS Lambda Durable**: CloudWatch durable function metrics (validates Cat 32)
- **Inngest**: Waterfall trace view (validates Cat 5), top-down monitoring dashboard (validates Cat 35), structured logging
- **Azure Durable**: Application Insights integration, MSSQL/Netherite backends
