# OTel sampling configuration

The configured-sampler behavior below is proposed and unreleased. See the
[OTel sampling guide](../../../../aws-durable-execution-sdk-js-otel/README.md#sampling)
for release applicability and provider requirements.

Set these before your OpenTelemetry SDK or ADOT provider initializes:

```sh
export OTEL_TRACES_SAMPLER=parentbased_traceidratio
export OTEL_TRACES_SAMPLER_ARG=0.1
```

With a compatible global provider, this follows a complete propagated parent's
sampled bit and samples 10% of root traces. An explicitly configured provider
sampler takes precedence over these environment settings.

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { createInvocationOtelPluginFactory } from "@aws/durable-execution-sdk-js-otel";

export const handler = withDurableExecution(
  async (_, context) => {
    const result = await context.step("prepare-result", async () => "ready");
    await context.wait("pause", { seconds: 1 });
    return result;
  },
  { plugins: [createInvocationOtelPluginFactory()] },
);
```

The completed step is skipped on resume. Durable spans use the same canonical
trace ID and sampling policy across both invocations. Keep the provider policy
unchanged during an execution. The Execution view uses the same rules.

Use `traceidratio` to apply the ratio regardless of parent flags, or `always_off`
to suppress every durable span even with upstream `Sampled=1`. A valid parent
without a sampled flag is unsampled for `parentbased_*`; an incomplete parent
uses its root policy.
