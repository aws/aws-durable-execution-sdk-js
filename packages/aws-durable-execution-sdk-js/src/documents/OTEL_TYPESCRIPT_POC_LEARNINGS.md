# OTEL Typescript Xray POC learnings

Some of these I believe Pooya already mentioned. I'm recompiling some of the learning for ease of reference.

### It's annoying to wire the lambda with OTel and Xray

The plugin is not plug and play. Integration with Xray is not straightforward.
We cannot use the recommended setup instructions [here](https://aws-otel.github.io/docs/getting-started/lambda#aws-lambda-layer-for-opentelemetry-arns)
because the recommended approach uses OTel BatchSpanProcessor class, which isn't compatible with the Otel plugin design
which needs to use SimpleSpanProcessor class.
I assume integrating with Datadog or other observability platforms would also be a pain point.

See [OTEL_XRAY_SETUP](https://github.com/aws/aws-durable-execution-sdk-js/blob/f64147ce32e6be2f809ed31a8fc1d79c4798ade9/packages/aws-durable-execution-sdk-js/src/documents/OTEL_XRAY_SETUP.md)
for more details on some other pain points.

### Operations with nested attempts across invocations cannot be exported as a single span.

We lose information about the previous `step` or `wait-for-condition` attempts on subsequent lambda replay invocations. This means
that we either only export the last "attempt" or we can export all the attempts,
but that will duplicate the operation across invocations. Even with predictable spanId (the span id is the same for the
same operation across invocations), they are visualized as a separate span, under a separate parent invocation. This may be because of the separate parent invocation span. I'm open to
further investigation here.

### Map and Parallel operations are best represented as nested parent, child spans. Not links.

I did not explicitly test the links but the "branches" of the map and parallel are naturally a child of the root map or parallel
operation span. The way our language SDK creates run-in-child-context operations naturally suits using child spans representing the map or parallel branches. There is no use for the links in our case.
Links are more useful when spans are in different traces or when the relationship is non-hierarchical. We don't have that
issue here.

### Spans split across traces without \_X_AMZN_TRACE_ID extraction

> The durable execution backend propagates the same Root traceId to every invocation via traceFields.
> But without explicitly extracting \_X_AMZN_TRACE_ID per invocation, each invocation creates a new root span with a new traceId.
> Fix: Extract \_X_AMZN_TRACE_ID inside the handler (not at module load) on every invocation.

This wasn't the case in my testing, but explicitly extracting the \_X_AMZN_TRACE_ID per invocation led to the Lambda API calls
to be part of the same trace.
