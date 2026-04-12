# How Restate Handles OpenTelemetry Tracing

## Architecture: Server-Side Tracing

The most important distinction about Restate's tracing model is where spans are created: **in the Restate server**, not the SDK or the user's code.

Restate is a separate server process that sits between the caller and the user's service. Because the server sees every operation — including sleeps, state reads, service calls — it can produce accurate, complete OTel spans without any involvement from the user's code.

Configuration is on the server, not in the SDK:

```bash
restate-server --tracing-endpoint http://localhost:4317
```

No SDK changes, no OTel packages in user code, no interceptors to register.

---

## How Restate Solves the Ancestor Span Problem

The Restate server has a persistent view of the entire invocation lifecycle. It does not need to create spans in the user's process — it creates them in the server process, which **never freezes**.

When a service hits `ctx.sleep('1 hour')`:

- The user's service process returns (the invocation suspends)
- The Restate server creates a `sleep` span with the correct start time
- One hour later, the Restate server resumes the invocation
- The `sleep` span ends with the correct end time (1 hour duration)
- The `invoke` span remains open in the server throughout

The `invoke` span is never in the user's process — it lives in the Restate server, which is always running. There is no freeze problem because the span owner never freezes.

---

## Key Takeaways for the AWS Durable Execution SDK

Restate's approach is the most elegant solution to the ancestor span problem, but it requires a persistent server component that owns the invocation lifecycle. AWS Lambda durable execution does not have an equivalent — the Lambda service manages execution state, but it does not produce OTel spans on behalf of user code.

| Restate approach                                  | AWS Durable Execution SDK situation                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Server-side tracing — server never freezes        | No equivalent; Lambda service does not produce user-level OTel spans                |
| Single `invoke` span for full invocation lifetime | Not achievable without a persistent server component                                |
| No replay guard needed                            | Replay guard needed; SDK handles via `onOperationStart` not firing for replayed ops |

The plugin model is the correct response to this constraint: give users the lifecycle hooks to implement whatever tracing strategy fits their needs.
