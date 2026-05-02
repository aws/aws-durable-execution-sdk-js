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

### Operations with nested attempts across invocations can be imported as a single span but there is an issue with "Operation" span duplication
For each "Attempt" span, we wish to nest under the parent "Operation" span. However, if there are multiple attempts, the onOperationStart and onOperationEnd hook may be triggered multiple times until the "Attempt" succeeds or the step fails due to running out of attempts.

Solution: Only export the Operation and Attempt span for the very last attempt.

### Map and Parallel operations are best represented as nested parent, child spans. Not links.

I did not explicitly test the links but the "branches" of the map and parallel are naturally a child of the root map or parallel
operation span. The way our language SDK creates run-in-child-context operations naturally suits using child spans representing the map or parallel branches. There is no use for the links in our case.
Links are more useful when spans are in different traces or when the relationship is non-hierarchical. We don't have that
issue here.

The main issue is that if we want onOperationStart and onOperationEnd hooks to only be called at most once. AND we wish to use these hooks to represent map and parallel operations as spans, then it's difficult to create the branches of the map and parallel under a single parent span. The completions of each branch may be spread across invocations which makes visualization difficult.

I am investigating whether it's possible to create a placeholder span that's not exported to tracing backend but that we can track in our plugin.

### Wait operation duplication issues

This is solved by https://github.com/aws/aws-durable-execution-sdk-js/commit/d75518f5b7a69dc30e65cc8326e9d97dcf4af639.

### Operations which span several invocations may be missing in the trace.

This is solved by the customIdGenerator. You have to ensure that the id's generated are deterministic.

### must use AlwaysOnSampler() to export spans across invocations which might not have parents.

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
