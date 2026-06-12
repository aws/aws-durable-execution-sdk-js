# Operator at Scale — Milestones & Project Breakdown

## Milestone 1: End-to-End Working POC (TypeScript)

**Goal:** Deliver a fully functional Operator at Scale implementation in TypeScript — from plugin configuration to data emission to queryable records in a destination, the goal is to share it (release candidate) and start gathring feedbacks.

**Scope:**

- Core plugin framework (plugin interface, lifecycle hooks, internal queue with batching/dedup)
- CloudWatch Logs destination plugin (default, zero-IAM-setup)
- S3 destination plugin (Athena-queryable, Parquet support)
- DynamoDB destination plugin (fast lookups by execution ID)
- OTel log emission (universal third-party support)
- Data curator (field selection, truncation, custom fields, sampling)
- Replay-safe emission (no duplicates during replay)
- Local testing support (emit to stdout/file)

**Exit criteria:**

- A customer can add one line of config and see execution data in CloudWatch Logs
- Sampling, field selection, and in-progress mode all configurable
- Published to NPM as `@aws/durable-execution-sdk-js-insight`

ETA:

- 1 dev month

## Next Milestones

- Gather feedback, finalize the plug-in interface and insight plug-in configurations
- Complete TypeSctipt insight plug-in
- Java insight plug-in
- Python insight plug-in
- Complete documentation
- UI components
- AWS Lambda console - workflow insight
