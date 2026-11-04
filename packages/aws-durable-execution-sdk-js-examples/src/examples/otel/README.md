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

The runnable [sampling example](sampling/otel-sampling.ts) configures an
application-owned `NodeTracerProvider` with `AlwaysOffSampler`. It checkpoints
active sampling observations before and after a durable wait. The completed
first step is skipped on resume, and both observations remain unsampled even
when the incoming header has `Sampled=1`.

Its [integration test](sampling/otel-sampling.test.ts) supplies a sampled parent
to the local runner and checks the configured decision, stable trace ID,
preserved first observation, and execution history. The same test can run
against a deployed example with the real Lambda carrier.

Run it from the repository root after building the SDK, testing, and OTel
packages:

```sh
npm run test --workspace packages/aws-durable-execution-sdk-js-examples -- otel-sampling
```

The example's explicit `AlwaysOffSampler` overrides the environment settings
above. Remove the explicit sampler to let `NodeTracerProvider` resolve them.
Keep the provider policy unchanged during an execution. The Execution view
uses the same rules.

Use `traceidratio` to apply the ratio regardless of parent flags, or `always_off`
to suppress every durable span even with upstream `Sampled=1`. A valid parent
without a sampled flag is unsampled for `parentbased_*`; an incomplete parent
uses its root policy.
