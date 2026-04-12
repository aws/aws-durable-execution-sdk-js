# Trace Context Propagation in the Durable Execution Backend

## What the Backend Does Today

When the durable execution service invokes a Lambda function, it passes trace context via the `traceFields` field on the invoke request. `traceFields` contains the AWS X-Ray trace header (`X-Amzn-Trace-Id`) from the original invocation. It is stored in `SwfExecutionMetadata` when the execution is first created and passed unchanged to every subsequent Lambda invocation.

The Lambda runtime reads `traceFields` and sets `_X_AMZN_TRACE_ID` in the environment before the function runs. This is why all invocations of the same durable execution share the same X-Ray `Root` trace ID.

**Result:** X-Ray tracing works end-to-end across all invocations with no SDK changes needed.

---

## The Gap: W3C `traceparent` Is Not Propagated

When a caller invokes a durable function from a service that uses W3C TraceContext, the initial request carries a `traceparent` header. However, this is not stored or propagated by the backend across invocations.

**Impact:** For non-X-Ray backends, invocation 1 can be connected to the upstream trace (the plugin extracts `traceparent` from the event), but invocation 2+ cannot.

---

## Options

### Option 1 — Store and propagate `traceparent` alongside `traceFields`

Extract the W3C `traceparent` from the initial invoke request, store it in `SwfExecutionMetadata`, and pass it to every subsequent Lambda invocation — symmetric with how `traceFields` works for X-Ray.

- ✅ Full end-to-end trace continuity for all OTel backends
- ⚠️ Backend change required

### Option 3 — SDK stores `traceparent` in the checkpoint

The plugin extracts `traceparent` from invocation 1 and passes it to the SDK, which stores it in the checkpoint. On invocation 2+, the SDK reads it from the checkpoint and passes it back to the plugin.

- ✅ No backend change required
- ⚠️ Small checkpoint overhead

### Option 4 — Accept the split, use span links

Don't propagate `traceparent` across invocations. The plugin uses span links to express causality between the upstream trace and the durable execution trace.

- ✅ No changes anywhere
- ❌ Caller must embed `traceId` in payload

### Option 5 — Fix the `clientContext` bug and propagate via `ClientContext.Custom`

The Lambda invoke API supports a `ClientContext` field. Callers pass `traceparent` in `ClientContext.Custom`; the Lambda reads it from `context.clientContext.custom.traceparent`.

**The current bug:** The backend does not store or forward `clientContext` across invocations. Any `clientContext` from the original caller is silently lost after invocation 1.

**What needs to change:** Extract `clientContext` from the initial invoke request, store it in `SwfExecutionMetadata`, and pass it on every `Invoke20150331Request`.

- ✅ No payload changes — trace context is separate from business data
- ✅ Works for any trace format
- ⚠️ Only works for direct Lambda invoke
- ⚠️ Requires fixing the backend bug (open ticket)

---

## Recommendation

**For X-Ray users:** Already works. No changes needed.

**For non-X-Ray OTel users:** Option 5 (`clientContext`) is the cleanest path for direct Lambda invoke once the backend bug is fixed. Option 1 (store `traceparent` in execution metadata) is the direction AWS is moving platform-wide (aligned with Step Functions' `OPTIONAL_W3C_HEADER` pattern).

---

## Current State Summary

| Backend                             | Trace continuity across invocations | What's needed                      |
| ----------------------------------- | ----------------------------------- | ---------------------------------- |
| AWS X-Ray                           | ✅ Works today                      | Nothing                            |
| OTel → X-Ray (ADOT)                 | ✅ Works today                      | Nothing                            |
| OTel → any (direct invoke)          | ✅ After backend fix                | Fix `clientContext` bug (Option 5) |
| OTel → Datadog / Jaeger / Honeycomb | ❌ Broken                           | Option 1, 3, 4, or 5               |
