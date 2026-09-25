# Shared persistent LMI tests

The 14 selected example suites (24 tests) and 12 lifecycle cases share **one**
persistent function, `js-lmi-e2e-shared:$LATEST.PUBLISHED`. This replaces the
previous 14 example functions plus three lifecycle functions. The function uses
Node.js 24 / arm64, 2 GiB, a 60-second invocation timeout, a 300-second durable
execution timeout, environment concurrency 2, one execution environment and
`AWS_LAMBDA_NODEJS_WORKER_COUNT=1`.

These are regression tests for [JS #927](https://github.com/aws/aws-durable-execution-sdk-js/issues/927),
including applicable scenarios from [Java #728](https://github.com/aws/aws-durable-execution-sdk-java/pull/728)
and [Python #743](https://github.com/aws/aws-durable-execution-sdk-python/pull/743).
Known SDK defects remain ordinary failing assertions. Adding tests does not fix
or close #927; local evidence does not replace deployed LMI validation.

## Persistent deployment and isolation

Following the Java suite's approach, deployment creates the CloudFormation stack
once and subsequently updates it. Stack, function, bucket and log group names are
stable. Ownership tags are checked before updates; failed stacks remain available
for investigation. Code objects are content-addressed. Code and deployment manifests do not expire,
since the active function, next deployment or CloudFormation rollback may still
reference them.

Each run gets its own `control/RUN/` and `events/RUN/` S3 prefixes; durable
deployment metadata is stored under `deployments/RUN/`.
The function receives the new run ID and commit through its environment. The
driver verifies its code digest, qualifier, runtime, worker count, concurrency,
scaling and run identity before invoking tests. Previous work is released and
settled before updating code. The workflow's global `js-lmi-e2e` concurrency group
serializes deployment, examples, lifecycle cases and settlement across all branches.
Use a different `--stack-name` for local work that must not share the CI fixture.

There is **no automatic function/stack/bucket deletion or expired-stack janitor**.
`settle` releases this run's controlled work and stops remaining test executions;
it retains all infrastructure. Only controls/events expire through
S3 lifecycle rules. The test-account operator owns the persistent resources,
execution role and capacity provider. The suite does not modify the provider.

## Reusing the function between cases

Example suites run with Jest `--runInBand`; lifecycle cases run sequentially.
After each case, the driver releases its latches and stops any remaining logical
executions, then probes the worker. The probe reports other invocations, held I/O,
lifecycle checkpoint requests, evidence writes, delayed observations and SDK timers still
active in that worker. It excludes its own invocation and does not cancel work,
clear SDK timers or destroy shared clients to manufacture an idle result.

Both the service's running-execution list and the worker activity inventory must
remain empty for at least **five continuous seconds**, with a **150-second drain
budget**. A non-diagnostic activity counter also resets the quiet window if
work occurs between samples; diagnostic probes do not reset it themselves. The SDK intentionally leaves suspended user stacks unresolved; those
stacks alone do not count as active work after the wrapper has returned and its
resources have settled. Quiet waiting is separate from the assertions already
made by the case: cleanup does not turn a regression failure into a pass.

If settlement fails, the suite quarantines the shared fixture and prevents later
cases from invoking it. Quiescence samples and release/stop errors are retained.
An idle previous run takes the short verification path; abandoned runs have their
controls released before reuse. Shared AWS connection pools may remain open.

## Existing example coverage

The generated registry bundles the original handlers selected by
`capacityProviderConfig`: retry success/exhaustion, stored errors, waits, polling,
callback success/failure/timeout, child contexts, map/parallel and serialization.
The example runner adds a checkpointed routing envelope to Invoke. The dispatcher
unwraps the original input for the selected handler, preserving all service
checkpoints and the checkpoint token. The original handler, testing SDK, result
assertions and event-history signatures execute unchanged. Raw service input
retains the routing envelope for diagnosis.

The examples and lifecycle tests are now in the same LMI workflow. The old
capacity-provider deploy/test/delete workflow is removed to avoid deploying the
same examples again as separate functions. Ordinary on-demand integration tests
continue to use their existing runner and deployment path.

## Lifecycle coverage and evidence

| Coverage | Cases |
| --- | --- |
| Same-worker concurrency | Shared decorated handler, child/map/parallel progress with branch concurrency 1 |
| Early completion | race/any, map/parallel `minSuccessful`, nested parallel, root return/failure with in-flight children |
| Suspension and replay | Real wait/resume, stored success and failure, no repeated completed bodies or artificial compensation |
| Warm reuse | Repeated success/failure/suspension with post-return timer observations |
| Actual deadlines | Held step and a real checkpoint response held at the SDK client boundary |
| Local races | Post-dispose checkpoint/force calls, queued immediates, polling rearmed after I/O |

Overlap is computed per `(requestId, gateId)` held interval. An earlier gate's
release or another gate's heartbeat cannot invalidate or establish the selected
hold. Deadline admission explicitly selects the original request; retries cannot
substitute for it. Environment/worker/request identifiers and live heartbeats
are required; concurrent client requests alone do not establish overlap.

Recovery controls are prepared before the deadline, and probe Invoke is scheduled
one second before it without S3 preparation or evidence polling on that path.
The fault and healthy peer remain held through deadline + five seconds. The
probe's handler-entry timestamp measures worker admission; its later blocked
step proves progress. Wall-clock and monotonic driver timestamps separate
preparation, Invoke, release, service registration and handler entry.

Late driver submission or late service registration is a collection error and
never extends the five-second recovery target. Invoke response latency is
recorded separately. `deadlines/*.json` reports scheduling, old-request writes,
recovery, healthy-peer progress and retry/replay independently, so one failure
cannot hide another. This five-second bound is a test acceptance target, not a
new SDK guarantee.

The checkpoint fault holds a genuine service response before delivering it to
the SDK; it does not claim to stall remote acceptance. Request-correlated service
history must establish the real platform timeout. Controlled work has a bounded
escape, which cannot satisfy regression assertions. Interrupted non-cooperative
work may repeat under at-least-once semantics. A deadline-step retry arriving
after release records `ALREADY_RELEASED`, never a fictitious new blocked interval.

JS has no Java-style shared executor or public invocation cancellation/independent
cleanup-registration API. The tests do not invent these APIs or install cleanup
plugins. Cooperative cancellation and listener/connection-lease reclamation
coverage still depend on the contract proposed in #927. JS suspension must not
artificially unwind business catch/finally; replay runs a fresh invocation.

## Run

From the repository root, with Node.js 24 and Python 3.12:

```sh
npm ci
npm run build -w packages/aws-durable-execution-sdk-js
npm run build -w packages/aws-durable-execution-sdk-js-testing
npm run generate-examples -w packages/aws-durable-execution-sdk-js-examples
pip install -r lmi-tests/requirements.txt
npm run test:lmi:harness
python -m pytest lmi-tests/tests --ignore=lmi-tests/tests/test_cloud.py
npm run test:lmi:regressions  # exposes unfixed #927 assertions
python lmi-tests/deploy.py build

export AWS_REGION=us-west-2
export CAPACITY_PROVIDER_ARN=arn:aws:lambda:REGION:ACCOUNT:capacity-provider:NAME
export TEST_ACCOUNT_ID=ACCOUNT
export TEST_LAMBDA_EXECUTION_ROLE_ARN=arn:aws:iam::ACCOUNT:role/ROLE
python lmi-tests/deploy.py deploy --stack-name js-lmi-local --run-id local-unique
node lmi-tests/run-examples.mjs
python -m pytest lmi-tests/tests/test_cloud.py --cloud -v
python lmi-tests/deploy.py collect
python lmi-tests/deploy.py settle
```

Use a fresh run ID each time. Set `LMI_RUNTIME_VERSION_ARN` if the temporary managed
runtime connectivity workaround in the workflow is still needed. The workflow
uses existing test-account OIDC credentials, runs for trusted PRs (including
Drafts), main pushes and manual dispatch, and retains fork/Dependabot restrictions.
It keeps histories, S3 events, logs, deployment identity, quiescence samples and
JUnit reports. The local-regression log and summary distinguish assertion failures
from harness execution errors; known assertions remain red until the SDK is fixed.
