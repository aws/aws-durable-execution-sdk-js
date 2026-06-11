# Workflow Insight — POC Approach & Plan

## What we're doing

We will build a POC of the Workflow Insight plugin in TypeScript, publish it to npm as a pre-release package, and share it with customers to gather feedback. We will wait for strong customer signal before investing in the next phase of the project.

## Known limitations of this approach

The plugin runs alongside the Durable Function SDK inside the Lambda invocation. This means:

- **Best-effort delivery only** — We cannot guarantee at-least-once, at-most-once, or any delivery semantics. Emission is best-effort.
- **No coverage for backend-initiated events** — Server-side state changes (STOPPED, TIMED_OUT) happen without a Lambda invocation, so the plugin cannot emit for these. Customers must subscribe to EventBridge lifecycle events and update their destination records themselves.

## Alternative approaches (not pursuing now)

| Option                           | Description                                                            | Why not now                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Service emits to EventBridge** | Our backend emits status-change events to customer's EventBridge bus   | Scaling, cost per event at high volume, configuration complexity                                                |
| **Backend creates curated data** | DAR backend builds curated records and pushes to customer destinations | Scaling, cost, credential management (accessing customer's S3/DDB/etc. from our backend), configuration surface |

Both alternatives have significant challenges around scaling, cost, configuration, and credential access. We will not pursue them unless we get strong customer feedback that the plugin approach does not address their needs.

## Milestones

| #   | Milestone               | Description                                                                          |
| --- | ----------------------- | ------------------------------------------------------------------------------------ |
| 1   | Alignment on proposal   | Agree on approach, design goals, and scope _(mostly complete)_                       |
| 2   | Working POC in Node.js  | Build and publish pre-release TypeScript plugin to npm                               |
| 3   | Customer feedback       | Share with customers, gather signal on whether the plugin approach works             |
| 4   | Alignment on next steps | Based on feedback (GitHub issues, customer conversations), decide what to build next |
| 5   | Multi-SDK support       | Expand to Java, Python, and other SDKs _(this is when other teams join)_             |

We proceed past Milestone 3 only with strong customer validation.
