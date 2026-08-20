# Durable Execution JS SDK — OpenTelemetry Conformance Tests

This package answers one question: does
[`@aws/durable-execution-sdk-js-otel`](../aws-durable-execution-sdk-js-otel) emit the spans
the durable execution OpenTelemetry specification says it must, on real Lambda, through a
real OTel pipeline?

Unit tests can't answer it. They can assert that a plugin hook fires and builds a span, but
not that the span survives the instrumentation layer, carries the right parent after a
suspend/resume, or still appears when the invocation fails. Those are properties of a
deployed function, so each scenario here is a Lambda function: it is deployed with an OTel
instrumentation layer, invoked once per requirement, and the telemetry it exports is fetched
back from the telemetry backend and diffed against the requirement's expected spans,
attributes, and parentage.

The requirements are cross-SDK and language-agnostic — the JS, Python, and Java SDKs are all
held to the same spans — so the specification and the runner that enforces it live in
[`aws/aws-durable-execution-conformance-tests`](https://github.com/aws/aws-durable-execution-conformance-tests),
along with the orchestration this package can't own alone: the backend matrix (X-Ray, Dash0,
Datadog, S3 collector), instrumentation layer discovery, collector layer build, and the
long-running launch/check cycle.

What lives here is the part that is specific to this SDK: the **handlers** that exercise each
scenario against the real SDK API, and the **SAM templates** that map them to requirement IDs.
They live in this repo, next to the code they instrument, so a change to the SDK or the OTel
plugin is validated by the suite in the same pull request that makes it, rather than after it
lands.

## Coverage

Three suites, 44 requirements:

| Suite               | Requirements             | What it pins down                                                                                                                                                                                                          |
| ------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `otel-invocation`   | `otel-invocation-1..20`  | The spans a single invocation emits: steps, attempts, retries, waits, callbacks, child contexts (including virtual ones, which emit a span without checkpointing a context), parallel, map, and the failure shape of each. |
| `otel-execution`    | `otel-execution-1..20`   | The same scenarios seen as one execution spanning many invocations — parentage has to hold across suspend and resume.                                                                                                      |
| `otel-long-running` | `otel-long-running-1..4` | Long durable delays, retry backoff, callbacks, and chained invokes, where the trace has to stay coherent over hours.                                                                                                       |

## Layout

```
handlers/
  common.ts                      # shared scenario wrapper + plugin selection
  otel_1_success.ts              # one handler per scenario (otel_1..otel_19)
  ...
  otel_20_long_wait.ts           # long-running scenarios (otel_20..otel_23)
  ...
template.yaml                    # otel-invocation + otel-execution suites, all backends
template-long-running.yaml       # otel-long-running suite
rollup.config.mjs                # bundles handlers/otel_*.ts -> dist/<name>.js (CJS)
__tests__/templates.test.ts      # guards template -> handler wiring and workflow inputs
```

Handlers must use the real SDK API and nothing else. A handler that fails because the SDK
emits the wrong telemetry is the suite working: that failure is the signal, and working
around it in the handler destroys the only thing being measured.

`handlers/common.ts` selects the plugin from the environment: `OTEL_PLUGIN_MODE=execution`
loads `ExecutionOtelPlugin`, anything else loads `InvocationOtelPlugin`. That is what lets one
handler module serve both the invocation-view and execution-view requirements — the template
deploys the same bundle twice and flips the variable, so the two views are guaranteed to be
observing identical workflow code.

## How a handler maps to a requirement

The link is the `TestingMetadata.TestDescription` field on each function in the SAM
template — the list of requirement IDs that handler satisfies:

```yaml
Otel1Success:
  Type: AWS::Serverless::Function
  Condition: DeployInvocationView
  TestingMetadata:
    TestDescription:
      - otel-invocation-1 # <- requirement ID in the conformance repo
  Properties:
    CodeUri: dist/
    Handler: otel_1_success.handler # <- dist/otel_1_success.js, exported `handler`
    FunctionName: !Sub "${AWS::StackName}-otel-invocation-1"
    Role: !Ref LambdaExecutionRoleArn
```

The runner reads that field to decide what to invoke and which expected telemetry to compare
against. Requirement definitions live in the conformance repo under
`packages/aws-durable-execution-conformance-tests-otel/test-requirements/<suite>/<id>.yaml`.
Adding a scenario therefore starts there: propose or find the requirement, then add the
handler and the template entry here.

## Building locally

Prerequisites: Node ≥ 22.

```bash
# from the monorepo root
npm ci
npm run build -w @aws/durable-execution-sdk-js
npm run build -w @aws/durable-execution-sdk-js-otel
npm run test -w @aws/durable-execution-sdk-js-conformance-tests-otel     # typecheck + wiring
npm run build -w @aws/durable-execution-sdk-js-conformance-tests-otel   # -> dist/*.js
```

The package consumes the SDK and the OTel plugin as workspace siblings, so a root `npm ci`
links them and the two builds above are what the handlers compile against.

`npm run test` runs `tsc --noEmit` over the handlers before the wiring guards. That ordering
is deliberate: the guards read the handlers as text, so without the typecheck a handler that
no longer compiles against the SDK could pass every required check on a pull request whose
deployed conformance run was skipped.

A full local run needs the orchestrator's supporting resources — an instrumentation layer,
exporter credentials, and a telemetry backend to query — so CI is the practical way to
execute the suite. Locally, `npm run test` checks the wiring and `sam build --template-file
template.yaml` confirms the templates package.

## CI

`.github/workflows/otel-conformance-tests.yml` runs on pull requests and pushes to `main`
that touch the SDK, the OTel plugin, this package, or the workflow itself. It calls the
conformance repo's reusable `opentelemetry-orchestrator.yml` at a pinned SHA with:

- `sdk_ref` set to the PR head SHA, so the suite validates the change under review
- `checkout_sdk: true`, which checks this repo out at `.build/durable-sdk` in the
  orchestrator's workspace
- `examples_dir` pointing at this package inside that checkout, so the orchestrator builds
  and deploys these handlers

Pull requests and pushes run the short phase: the invocation and execution suites in full,
plus the long-running suites with a real but brief 60-second delay. The ~23-hour
launch/check cycle runs only via `workflow_dispatch` with `phase: launch` / `phase: check`.

Two things to know when reading a run. Backends whose credentials are absent are skipped
rather than failed, so a green run does not necessarily mean every backend was exercised.
And the suite jobs skip entirely for pull requests from forks, because they need AWS
credentials.
