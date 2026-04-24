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

This wasn't the case in my testing, but explicitly extracting the \_X_AMZN_TRACE_ID per invocation groups the Lambda API calls into the operation trace.

### Wait operation duplication issues

Wait operations often start in one invocation and are resolved in another. Most times, they are completed while there is no invocation and lambda is idle. This is a problem for the current plugin
model because we have no way of knowing if we have exported a duplicate span representing the wait. The immediate most obvious short term fix is to introduce some sort of cache which would persist that we have already exported a span for the wait across invocations.

### Steps within run-in-child-context which complete in separate invocations.

There is a similar issue with steps, to ensure that all steps are represented we have no choice but to register a span upon seeing a step operation on replay. This leads to multiple duplicate spans representing the same steps at the invocation level.

### weird span drop issue

For map and parallel operations, if you have many branches, meaning you have child-contexts nested in root child-context. If a child context completes over multiple invocations, it can drop
an operation span if there's no wait after. I don't know how else to describe this at the moment.

```
    const parallelWaitsResults = await context.parallel([
      // Branch 1: Returns "basketball"
      async (ctx: DurableContext) => {
        await ctx.wait("wait-sport-step-1", { seconds: 5 });
        const result = await ctx.step("sport-step-1", async () => {
          return "basketball";
        });
        await ctx.wait("wait-sport-step-1-2", { seconds: 5 });
        return result;
      },

      // Branch 2: Returns "football"
      async (ctx: DurableContext) => {
        await ctx.wait("wait-sport-step-2", { seconds: 10 });
        const result = await ctx.step("sport-step-2", async () => {
          return "football";
        });
        return result;
      },

    ]);
```

The `sport-step-2` is completely dropped from the trace for some reason, even though it should have completed in the same invocation following the 10 second wait.
