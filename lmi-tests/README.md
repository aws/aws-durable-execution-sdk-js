# LMI lifecycle regressions

These tests extend the capacity-provider examples with the invocation-lifecycle
contracts in [JS #927](https://github.com/aws/aws-durable-execution-sdk-js/issues/927).
They assert desired behavior; known defects are ordinary failures in a separate
local-regression job and in the cloud job. Adding these tests does not fix or
close #927, and a local result is not evidence of deployed LMI correctness.

The fixture calls this checkout's built JS SDK, without instrumentation plugins.
It uses one decorated handler and shared Lambda/S3 clients across invocations.
A client decorator records attempted checkpoints, token hashes, service request
settlement and actual sends. It does not simulate service token acceptance.

| Coverage | JS tests | Related coverage |
| --- | --- | --- |
| Early completion and late-operation rejection | `race`, `any`, `map`, `parallel`, nested parallel, return/failure with an in-flight child | JS #927; Python #743 early completion and abandoned children; Java #728 in-flight cleanup |
| Overlapping roots and nested progress | Same worker barriers; child/map/parallel with `maxConcurrency: 1` | Java #728 executor starvation; Python #743 branch pool progress |
| Stored success/failure and suspension | Real wait and resume, stable failures, no duplicate completed bodies or artificial compensation | All three references |
| Actual invocation deadline | Held step; real checkpoint response held across the platform deadline; original worker recovery and live peer | JS #927; Java #728 and Python #743 timeout isolation |
| Warm reuse | Nine success/failure/suspension cycles; SDK timers/immediates observed after return; shared client remains usable | All three references |
| Disposal races (local) | checkpoint/force after dispose, queued immediate, in-flight polling response | JS #927 |

The broader capacity-provider catalog also opts in existing retry-success,
retry-exhaustion, replayed-error, callback success/failure/timeout, wait/polling,
child-context, map/parallel and serialization examples: **14 suites / 24 tests**.
Their existing local/cloud assertions and event histories are reused.

## Language-specific limits

Java's finite shared executor and Python's thread pools have no direct JS API
counterpart. The JS port tests nested progress through the public context APIs;
it does not inject an artificial executor. Java's `finally-before-PENDING`
contract is also not the JS suspension contract. JS suspended stacks stay pending:
these tests assert no artificial rejection, compensation, or old-stack `finally`,
while stored successes/failures replay in a fresh invocation.

JS currently exposes neither an invocation cancellation signal nor an independent
invocation resource-cleanup registration API. This suite does not invent those
APIs or install a test plugin that cleans up on the SDK's behalf. Gates model
**non-cooperative**, already-running work; their effects are recorded but are not
asserted to be exactly-once or cancellable. Cooperative I/O cancellation, cleanup
registrations, listener/connection-lease reclamation and repeated timeout/retry
cycles still need tests once #927 defines those contracts. The timer observer
covers SDK-created timeouts/immediates, excluding fixture I/O and shared pools.
These limitations mean this PR alone cannot satisfy all of #927's fix acceptance.

The checkpoint deadline fixture holds a response from a **real, completed** AWS
checkpoint request before returning it to the SDK. It tests an SDK async boundary;
it does not claim to stall the remote service or prove that a sent checkpoint can
be retracted. Timeout evidence must identify the original request in service
invocation history. A logical durable timeout or a client polling timeout cannot
substitute for an actual platform invocation timeout.

## Evidence and isolation

Cloud deployment uses Node.js 24 / arm64, 2 GiB, environment concurrency **2**,
exactly **one Node.js worker** (`AWS_LAMBDA_NODEJS_WORKER_COUNT=1`),
and native scaling limits of exactly **one execution environment**. The worker
count is explicit because [LMI defaults to multiple workers](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-nodejs-runtime.html);
environment concurrency 2 alone does not force both requests onto one worker. A shared
`/tmp` UUID identifies the environment; a module UUID, PID and worker thread ID
identify the Node worker. Each request records live held-work heartbeats. The
suite requires overlapping intervals inside the same worker before admitting
lifecycle assertions. Concurrent client requests or matching start records alone
do not pass. Placement/collection failures are errors, separate from assertions.

S3 holds explicit `hold`/`release` controls and immutable per-request event records.
The winner waits for loser entry and an external release. The driver releases the
loser only after recording the actual SDK wrapper return, keeps a companion live,
and continues observing. Timestamps and worker sequence numbers describe event
order; eventual log delivery never extends a lifecycle budget. Token values are
hashed; raw checkpoint tokens/callback IDs are redacted from retained artifacts.

Normal fixtures have a 180-second invocation timeout; two separate deadline
fixtures have 60-second timeouts. Durable executions are bounded at 300 seconds.
Gates have a 120-second emergency escape, which cannot satisfy an assertion.
The proposed recovery budget is deadline + 5 seconds, matching the related PRs;
it is a test acceptance target, not a newly documented SDK guarantee. Deadline
fixtures are separate from ordinary/warm cases to avoid cross-case contamination.
Each case releases its controls and stops remaining logical executions; final
cleanup retires the run-owned functions before deleting their evidence bucket.

The deployment/cleanup driver adapts the run-owned CloudFormation approach in
[Python #743](https://github.com/aws/aws-durable-execution-sdk-python/pull/743).
It creates unique tagged stacks, retains deployed configuration and code SHA-256,
checks `$LATEST.PUBLISHED`, concurrency, scaling, runtime and commit identity,
and reconciles expired stacks with the same suite ownership tags. The existing
capacity provider and execution role remain owned by the test-account operator.
The bucket policy grants that role access only to this run's controls/evidence.
The account needs CloudFormation, Lambda, S3 and Logs permissions and network
access to Lambda/S3 endpoints. The workflow uses existing test-account OIDC secrets.

## Run

From the JS repository root, with Node.js 24 and Python 3.12:

```sh
npm ci
npm run build -w packages/aws-durable-execution-sdk-js
pip install -r lmi-tests/requirements.txt
npm run test:lmi:harness
python -m pytest lmi-tests/tests --ignore=lmi-tests/tests/test_cloud.py
npm run test:lmi:regressions  # expected to expose unfixed #927 assertions
python lmi-tests/deploy.py build

export AWS_REGION=us-west-2
export CAPACITY_PROVIDER_ARN=arn:aws:lambda:REGION:ACCOUNT:capacity-provider:NAME
export TEST_ACCOUNT_ID=ACCOUNT
export TEST_LAMBDA_EXECUTION_ROLE_ARN=arn:aws:iam::ACCOUNT:role/ROLE
# If needed, set LMI_RUNTIME_VERSION_ARN to the same temporary runtime pin used
# in packages/aws-durable-execution-sdk-js-examples/scripts/deploy-lambda.ts.
python lmi-tests/deploy.py deploy --run-id local-unique --concurrency 2
python -m pytest lmi-tests/tests/test_cloud.py --cloud -v
python lmi-tests/deploy.py collect
python lmi-tests/deploy.py cleanup
```

`.github/workflows/lmi-lifecycle-tests.yml` runs harness, local regressions and
cloud tests for every trusted PR update (including Draft PRs), main push and
manual dispatch. Fork/Dependabot cloud credential restrictions are preserved.
The cloud job depends only on passing harness tests so known local regressions
do not suppress deployed evidence. No regression uses `skip`, `xfail`, or
`continue-on-error`. Workflow cleanup runs even after failure; an expired-resource
reconciler handles interrupted jobs. Histories, S3 events, runtime logs, deployment
identity, JUnit outcomes and cleanup diagnostics are retained as artifacts.

The local-regression job emits readable test diagnostics to its live log as well
as JUnit. Its job summary separates assertion failures from test execution errors
(such as missing checkpoint-operation metadata); an execution error is not SDK
regression evidence. The passing harness job exercises the in-flight polling
fixture while its manager is open, so setup failures are caught independently
of the intentionally failing post-disposal contract.

## Deadline measurement

Overlap is evaluated per `(requestId, gateId)` held interval. `BLOCKED`, `ALIVE`,
`RELEASED` and wrapper-exit events bound those intervals; a previous gate's release
or another gate's heartbeat cannot close or validate the selected hold. Deadline
admission explicitly selects the original request's `transport`/`loser` gate and
the companion's `peer` gate. Retries cannot substitute for the original request.
A reduced trace from cloud run `35911675108` reproduces the old false placement
failure in the harness, alongside stale-heartbeat and wrong-worker controls.

The recovery probe's controls are prepared before the deadline. Invoke is scheduled
one second before the deadline, with no S3 writes or event polling on that path.
The victim and healthy peer remain held through deadline + 5 seconds; manual fault
release starts only after that window. Evidence collection follows submission and
the observation window. The worker's `ENTER` timestamp measures admission;
`BLOCKED` subsequently proves probe progress and overlap, without charging the
probe's own first step/checkpoints against worker admission time.

Per-invocation artifacts record wall-clock and monotonic timestamps for preparation,
each control PUT, Invoke begin/end and release. Scheduling more than one second
late (after the actual deadline), or service `ExecutionStarted` after deadline + 1 second is a collection error:
such a run did not establish timely recovery demand. These checks never extend
the SDK's five-second recovery bound. Invoke response latency is diagnostic and
does not invalidate timely service acceptance. Monotonic timestamps measure driver spans;
wall-clock timestamps correlate with the worker deadline and service history.

`deadlines/*.json` records probe scheduling, old-request writes, worker recovery,
healthy-peer progress and service-retry replay as independent outcomes. A failed
recovery or observation check does not suppress evaluation of late checkpoints
from the original timed-out request. The final test fails if any contract or
observation failed and preserves every outcome. Deadline-step retries arriving
after controlled I/O release record `ALREADY_RELEASED` and may finish interrupted
work; they never manufacture a `BLOCKED` event or relax the original admission gate.
