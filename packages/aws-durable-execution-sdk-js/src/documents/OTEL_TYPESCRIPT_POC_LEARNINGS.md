# OTEL Typescript Xray POC learnings

Some of these I believe Pooya already mentioned. I'm recompiling some of the learning for ease of reference.

### Spans which are not closed, are not exported to observability backend

This means that for many operations, we cannot start the span when the operation genuinely starts (for example, when the operation START is checkpointed). It's possible for any of these operations to start within 1 lambda invocation, and for it to end in any subsequent lambda invocation. Between lambda invocations, the Otel exporter is re-initialized, unclosed "operation" spans are lost.

Feature request on otel side: https://github.com/open-telemetry/opentelemetry-specification/issues/373

Solution: we create the span in onOperationEnd and backfill both the startTime and endTime for the operation within the span attributes.

#### must use AlwaysOnSampler() to export spans across invocations which might not have parents.

```
const exporter = new OTLPTraceExporter({
  url: "http://localhost:4318/v1/traces",
});

const provider = new NodeTracerProvider({
  idGenerator: new AWSXRayIdGenerator(),
  spanProcessors: [new SimpleSpanProcessor(exporter)],
  sampler: new AlwaysOnSampler(),
});

provider.register({ propagator: new AWSXRayPropagator() });
```

### Operations with nested attempts across invocations can be imported as a single span but there is an issue with "Operation" span duplication

For each "Attempt" span, we wish to nest under the parent "Operation" span. However, if there are multiple attempts, the onOperationStart and onOperationEnd hook may be triggered multiple times until the "Attempt" succeeds or the step fails due to running out of attempts.

Solution: Only export the Operation and Attempt span for the very last attempt.

### Map and Parallel operations are best represented as nested parent, child spans. Not links.

I did not explicitly test the links but the "branches" of the map and parallel are naturally a child of the root map or parallel
operation span. The way our language SDK creates run-in-child-context operations naturally suits using child spans representing the map or parallel branches. There is no use for the links in our case.
Links are more useful when spans are in different traces or when the relationship is non-hierarchical. We don't have that
issue here.

The main issue is that if we want onOperationStart and onOperationEnd hooks to only be called at most once. AND we wish to use these hooks to represent map and parallel operations as spans, then it's difficult to create the branches of the map and parallel under a single parent span. The completions of each branch may be spread across invocations which makes visualization difficult.

I am investigating whether it's possible to create a placeholder span that's not exported to tracing backend but that we can track in our plugin. When the parent context completes, the span is actually exported and the child spans are then populated inside the parent span.

### Wait operation duplication issues

This is solved by https://github.com/aws/aws-durable-execution-sdk-js/commit/d75518f5b7a69dc30e65cc8326e9d97dcf4af639.

### Operations which span several invocations may be missing in the trace.

This is solved by the customIdGenerator. You have to ensure that the id's generated are deterministic.

### Auto instrumentation API calls are not nested properly

This is due to the usage of `startSpan()` instead of `startActiveSpan` which has forced us to manage the span parent-child relationships manually. In addition, for the opentelemetry-js library, there's no method which allows us to manually update a particular span or context to be "active". See [here](https://github.com/open-telemetry/opentelemetry-js/issues/3558). This doesn't work well with the auto instrumentation layer since when the API calls are actually performed, the parent span is often wrong as it's not updated.

Solution: I'm introducing 3 new hooks which wrap the invocation, the step attempts and the run-in-child-context. The name of these hooks are up for debate but at the moment, I've named them onInvocation, onOperationAttempt, onOperation. This allows our typescript code to utiliza the recommended `context.with(ctx,fn)` pattern which allows us to correctly update the parent context for those autoinstrumented API call spans.
Commit: https://github.com/aws/aws-durable-execution-sdk-js/commit/8f9fd307874701307c8dae5d6c283335e99cb83e
