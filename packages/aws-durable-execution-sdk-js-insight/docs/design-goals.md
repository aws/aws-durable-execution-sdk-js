# AWS Durable Execution: Operator at Scale — Design Goals

We want to deliver an "operator at scale" feature for AWS Lambda Durable Execution that addresses the observability needs customers have expressed for managing workflow executions in production. Rather than building a single opinionated solution, we are designing a flexible, configurable system that adapts to diverse customer needs, cost sensitivities, and operational maturity levels.

## Design Goals

### 1. Opt-in

We should not force observability overhead on all customers. The feature must be explicitly enabled — customers who don't need it pay nothing and experience no performance impact. This respects the serverless principle of paying only for what you use.

### 2. Destination-agnostic

We should not force one type of destination for operational data. Developers have different use cases, existing tooling, compliance requirements, and cost criteria. The system must support multiple destination types (e.g., CloudWatch Logs, S3, Kinesis, third-party endpoints) and allow customers to choose what fits their stack.

### 3. Fully configurable data content

There is no one-size-fits-all solution. Some developers need full execution detail (inputs, outputs, step-level data) for debugging. Others prioritize cost and only need status summaries. Customers should be able to configure exactly what data fields to include — execution input, execution output, step inputs/outputs, error details, or any subset thereof.

### 4. Sampling

Customers should be able to control sampling rates. For many statistical and business use cases, there is no need to record all executions. For example, an insurance company asking "how many claims are rejected per week" may get a good estimate from 5% sampling. Sampling dramatically reduces cost and processing overhead while still enabling aggregate analytics.

Sampling is decided per execution at start time: if an execution is sampled in, all its data is emitted (every status change, every operation update, through completion). If it's sampled out, nothing is emitted for that execution. This ensures consistent, complete records for sampled executions rather than fragmented partial data. Sampling applies uniformly regardless of whether in-progress or finished-only mode is configured.

### 5. Support both in-progress and finished executions

Supporting in-progress executions requires significantly more data updates — every operation status change triggers an update, adding cost and processing overhead. Some customers need real-time visibility into running workflows and are willing to pay for it. Others only need post-completion records and consider the in-progress overhead a hard no. By supporting both modes, we satisfy both groups. Note: some destinations (e.g., CloudWatch Logs) don't support updating records — for these, we emit multiple records and customers filter to the latest.

### 6. Processed (curated) data, not raw events

Raw execution event history has extensive detail but is difficult to query — each execution can have thousands of events, and grouping/joining at query time is slow and expensive. Storing raw events long-term is also costly. Instead, we curate a prepared, denormalized record based on the developer's configuration and preferences. This pre-processed data is optimized for the queries customers actually run (filtering, aggregation, trending) rather than forcing them to reconstruct workflow state from raw events.

### 7. Latency-aware emission

The observability pipeline must not add latency to the workflow execution hot path. Emitting operational data should be asynchronous and non-blocking. A slow or unavailable destination should never cause a workflow step to fail, timeout, or slow down. The execution engine's performance guarantees remain unchanged regardless of observability configuration.

### 8. Schema stability & forward compatibility

The emitted data schema must be versioned and backward-compatible. Customers build dashboards, alerts, queries, and automation on top of this data. Breaking the schema on SDK or service upgrade would break their operational tooling. Schema evolution must be additive (new fields) rather than destructive (renamed/removed fields).

### 9. Correlation-friendly

Every emitted record should carry enough context — execution ID, step name, function name, timestamp, version — to be joinable with other telemetry sources (CloudWatch Logs, X-Ray traces, custom application metrics) without requiring customers to manually inject correlation IDs. A customer should be able to go from an operational record to the corresponding trace or log group in one click.

### 10. Multi-execution queries by design

The data format should be optimized for cross-execution queries ("show me all failed executions this week", "what's the p95 duration by workflow type") — not just single-execution inspection. This means flat, denormalized records that can be filtered and aggregated without JOINs across thousands of rows. The schema should support the most common query patterns identified in our research: filter by status, time range, function name, and custom dimensions.

### 11. Replay-safe

Emission should only happen for new progress, not during replay. If a workflow replays 50 completed steps to reach step 51, only step 51's data should be emitted — not 50 duplicate records for already-completed steps. This is critical for correctness of metrics, cost control, and avoiding confusion in customer dashboards.

### 12. Retention decoupled from execution retention

Operational data retention should be independently configurable from execution state retention. A customer might keep execution state for 7 days (for recovery and replay) but keep operational/analytics data for 90 days (for trending, compliance, and business intelligence). These are different concerns with different cost profiles.

### 13. Cost transparency

Customers should be able to estimate the cost of their observability configuration before enabling it. Provide a cost model or calculator: "with X executions/day, Y steps/execution, Z data fields included, and destination D, your estimated monthly cost is $N." No surprises on the bill.

### 14. Graceful degradation

If the destination is unavailable, throttled, or experiencing errors, the system should handle it gracefully based on customer configuration:

- Buffer and retry (with backoff)
- Drop and continue (with metric counting drops)
- Never fail the workflow execution
- Never lose data silently without notification

Customers choose their trade-off between data completeness and execution reliability.

### 15. Testability in local development

The observability configuration should work in local testing environments. Developers should be able to verify what data will be emitted — format, content, frequency — before deploying to production. Support emission to stdout, local file, or local container during development and testing.

### 16. First-class AWS service destinations

Support popular AWS services as data destinations out of the box, with built-in integrations or helper functions that handle serialization, batching, error handling, and IAM permissions. Customers should not need to write glue code for common destinations.

**Supported destinations should include:**

- **S3** — cost-effective archival and batch analytics (queryable via Athena)
- **DynamoDB** — fast single-execution lookups by ID, TTL-based retention
- **Aurora / RDS** — full SQL querying, complex filtering, aggregation
- **CloudWatch Logs** — zero-setup integration with existing Lambda monitoring and Log Insights queries
- **Kinesis Data Streams / Firehose** — real-time streaming to multiple consumers, buffered delivery to downstream stores
- **EventBridge** — event-driven routing to any target (Lambda, SNS, SQS, Step Functions), enabling custom reactions to workflow lifecycle events

Each destination has different trade-offs (cost, query capability, latency, update support) and serves different customer patterns. The system should make it easy to choose the right destination for the use case without requiring deep AWS expertise.

### 17. Direct third-party destination support (no double-hop)

Customers who use third-party observability or analytics platforms (Datadog, Splunk, Snowflake, Grafana Cloud, etc.) should be able to send data directly to those destinations without routing through an intermediate AWS service first. Requiring a double-hop (e.g., emit to S3 then trigger a Lambda to forward to Datadog) adds unnecessary cost, latency, and operational complexity. The system should accept third-party endpoints (HTTPS webhooks, OTLP endpoints, custom URLs) as first-class destinations alongside AWS-native services.

### 18. Customer-owned storage (no platform-internal data store)

Operational data should be stored in destinations that the customer owns and has full control over — not in an internal store managed by our service. It's the customer's data: they should control access, retention, encryption, sharing, and deletion. We emit data to their chosen destination; we don't hold it. This means no proprietary query UI that only works against our internal database, no vendor lock-in on the data layer, and no "contact support to export your data" scenarios. Customers can query, transform, share, and delete their operational data using their own tools and permissions.

### 19. No new query API in our service

Since customers own the data in their own storage, there is no need for us to build and operate a dedicated query API or internal query infrastructure. Instead, queries are executed directly against the customer's destination using the customer's own IAM credentials. For AWS destinations, the Workflow Insight UI knows how to construct and execute queries natively (Athena for S3, Log Insights for CloudWatch, SQL for Aurora, DynamoDB queries). For third-party or custom destinations, customers use the open-source UI library and implement their own query adapter. In both cases, we never store or proxy the query results — the customer's IAM role must have access to the destination, and queries run in their security context.

### 20. Workflow Insight UI with natural language query

We will provide a Workflow Insight UI that helps customers query and find executions without needing to know the query language of their chosen destination. The UI supports two modes: structured filters (select status, time range, function name, etc. from dropdowns) and natural language query (customer types what they need in English — e.g., "show me all failed executions for the payment workflow in the last 24 hours" — and we construct the appropriate query for their destination).

**How it works with destinations:**

- **AWS destinations (out-of-the-box):** Customers specify their destination in configuration (e.g., S3 bucket `bucket123`, or CloudWatch log group `/aws/durable/my-function`). The UI uses the logged-in customer's IAM role to query that data source directly. No additional setup required — we know how to query each supported AWS destination natively.
- **Third-party / custom destinations:** The Workflow Insight UI cannot query arbitrary external systems out of the box. For these, customers use the open-source customizable UI library (Goal 21) and implement a query adapter that defines how to send queries and receive results from their destination.

### 21. Multiple access surfaces (Console, IDE, customizable open-source UI)

Workflow Insight should be accessible from where developers already work, not just the AWS Console. We provide three surfaces:

1. **AWS Console** — full Workflow Insight experience integrated into the Lambda console. Works out-of-the-box with supported AWS destinations using the customer's IAM role.
2. **AWS Toolkit for VS Code** — same functionality available inside the IDE, so developers can query and inspect executions without leaving their editor. Same destination support as the Console.
3. **Open-source customizable web UI** — a standalone web application that provides the same Workflow Insight capabilities but is fully open source. Developers can fork, modify, and embed it into their own custom dashboards. Critically, this is where customers using third-party or custom destinations implement their own query adapter — defining how to connect to their destination, send queries, and parse results. This makes the UI extensible to any destination without requiring us to support every possible backend.

### 22. Compute-agnostic / extensible to future runtimes

The Workflow Insight solution should have no hard dependency on the current Lambda execution environment or backend service architecture. Today, durable executions run on Lambda (and Elevator), but the observability layer should be designed so it can be extended to new compute environments (e.g., MicroVM) without redesigning the system. This means:

- The data emission library is a standalone component that can be adapted or reimplemented for different runtimes.
- The data format, destination configuration, and query UI are independent of where the compute runs.
- No assumptions about Lambda-specific APIs, invocation models, or infrastructure in the observability pipeline itself.

This ensures we can deliver the same operator-at-scale experience regardless of the underlying compute, and avoids rework when new execution environments are introduced.

### 23. Sensible defaults / one-line getting started

Despite the extensive configurability (Goals 2–5), the getting-started experience must be simple. A customer should be able to enable Workflow Insight with a single line of configuration using sensible defaults — e.g., emit to CloudWatch Logs, all fields included, no sampling, finished executions only. Advanced configuration (custom destinations, sampling rates, field selection, in-progress mode) is available but never required. The principle: zero-to-value in under a minute, optimize later.

### 24. Multi-destination support

Customers should be able to emit operational data to multiple destinations simultaneously — e.g., S3 for cheap long-term archival AND CloudWatch Logs for real-time debugging, or DynamoDB for fast lookups AND Datadog for alerting. This is naturally supported by our architecture: the data extractor/submitter is implemented as a plugin for the Language SDK library, and the SDK supports multiple plugins. Each plugin targets a different destination with potentially different configuration (different fields, different sampling rates). No additional infrastructure or fan-out logic required.

### 25. Security & credentials management

Destination credentials must be handled securely. For AWS destinations, the Lambda function's execution role (IAM) provides access — no additional credential management needed. For third-party destinations requiring API keys or tokens, customers use AWS Secrets Manager or environment variables, and the plugin retrieves credentials at runtime. Since our compute is Lambda, functions already have native access to Secrets Manager, SSM Parameter Store, and IAM-based service authorization — we leverage these existing mechanisms rather than inventing a new credential system. Data in transit to destinations must be encrypted (TLS). Customers can use their own KMS keys for encryption at rest where the destination supports it (S3, DynamoDB, CloudWatch).

### 26. Configurable delivery guarantees

Delivery guarantees should be configurable per destination plugin. The default should be relaxed (best-effort / at-most-once) to minimize overhead and align with Goal 7 (no latency impact). Customers who need stronger guarantees (at-least-once with retry and buffering) can opt into them, accepting the additional cost and complexity. Since delivery is handled by plugins, different plugins can offer different guarantee levels — a CloudWatch Logs plugin might offer at-least-once with built-in retry, while a custom webhook plugin might default to best-effort fire-and-forget.

### 27. Third-party plugin support

The plugin architecture is open to third-party contributions. Developers and third-party companies (observability vendors, analytics providers, consulting firms) can create and publish their own destination plugins with custom delivery guarantees, serialization formats, batching strategies, and authentication methods. We provide a well-defined plugin interface and documentation; the ecosystem builds on top of it. This means we don't need to support every possible destination ourselves — the community and vendors can fill gaps for niche or proprietary systems.

### 28. Observable emission pipeline (monitoring the monitor)

Customers need to know if the emission pipeline itself is working. They can enable CloudWatch Metrics to track the health of data emission — records emitted, records dropped, destination errors, emission latency, and record size. These metrics allow customers to set CloudWatch Alarms (e.g., "alert if records are being dropped" or "alert if destination errors spike"). The metrics configuration is customizable: customers can adjust metric names, namespaces, dimensions, and thresholds to fit their existing monitoring conventions. Without this, a broken emission pipeline would be invisible — data silently stops flowing and nobody knows until they open the Workflow Insight UI and find it empty.

### 29. Custom fields / user-defined attributes

Customers can attach arbitrary key-value metadata to executions from their workflow code (e.g., `customerId`, `orderAmount`, `region`, `claimType`) that gets included in the emitted record. This enables business-dimension queries (Goal 10) — "show me all failed executions for customer X", "what's the average duration grouped by region", "how many claims were rejected this week by type." Without custom fields, the only queryable dimensions are what the platform defines (status, function name, time). With them, customers can slice and filter by any business-relevant attribute they choose.

### 30. Backfill historical executions _(post-initial launch)_

When a customer enables Workflow Insight on a function that already has completed executions, they should be able to backfill historical data into their chosen destination — not just see new executions going forward. This allows immediate value from day one rather than waiting days or weeks for enough new data to accumulate. **This goal will not be included in the initial launch** and will be delivered in a subsequent release. Initial launch will only emit data for executions that start after the feature is enabled.

### 31. Size limits & truncation

Execution inputs, outputs, and operation data can be large — but destinations have size limits (DynamoDB 400KB items, CloudWatch Logs 256KB events). We will truncate execution input, execution output, and operation data to fit within destination constraints. Each built-in destination plugin uses a known-good default size limit appropriate for that destination. Developers can fine-tune the truncation threshold per field if they want smaller records (to reduce cost) or larger records (if their destination supports it). Truncated fields are clearly marked so customers know data was cut, not missing.

### 32. Configuration changes apply to new executions only

Observability configuration is tied to the function version, following the same model as durable Lambda itself — developers invoke executions using a fully qualified ARN (version or alias). Any configuration change (adding fields, changing sampling, switching destinations) applies only to new executions started after the change. In-progress executions continue with the configuration they started with. This avoids mid-execution inconsistencies (e.g., half the records with field X, half without) and gives customers a clean, predictable boundary for configuration changes.
