# Durable Execution JS SDK — Durable Execution Telemetry Conformance Tests

This package answers one question: does
[`@aws/durable-execution-sdk-js-telemetry-exporter`](../aws-durable-execution-sdk-js-telemetry-exporter), with its
`CloudWatchLogsExporter`, deliver a complete `DurableExecutionTelemetry` record to CloudWatch Logs for a
real Lambda execution?

Unit tests can assert that the plugin builds a record. They cannot assert that the record
survives the `wrapInvocation` drain on a real invocation, reaches the configured log group,
and carries the right identity fields for the deployed function. Those are properties of a
deployed function, so the scenario here is a Lambda function: it is deployed with the plugin
configured, invoked once, and the record is fetched back from CloudWatch Logs and checked
against the requirement.

The requirement and the runner that enforces it live in
[`aws/aws-durable-execution-conformance-tests`](https://github.com/aws/aws-durable-execution-conformance-tests),
package `aws-durable-execution-conformance-tests-telemetry`. What lives here is the SDK-specific
part: the handler and the SAM template that maps it to the requirement ID.

## Coverage

| Suite     | Requirements | What it pins down                                                                                                                           |
| --------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `telemetry` | `telemetry-1`  | One successful single-step execution emits one `SUCCEEDED` record with `input`, `output`, ARN-derived identity fields, and `operationsByName`. |

## Layout

```
handlers/
  telemetry_1_success.ts           # single step "increment"; plugin + CloudWatchLogsExporter
template.yaml                    # telemetry suite; declares TelemetryLogGroupName and creates the group
rollup.config.mjs                # bundles handlers/telemetry_*.ts -> dist/<name>.js (CJS)
__tests__/templates.test.ts      # guards template -> handler wiring and the parameter contract
__tests__/workflow.test.ts       # guards the caller workflow: inputs, secrets, triggers, permissions, paths
```

The handler uses the real SDK API only. It constructs no record and calls no exporter method.
A missing or wrong record is the plugin's defect and is the signal the suite measures.

## Template contract

The runner passes `TelemetryLogGroupName` from the extension. Extensions have no pre-deploy
hook, so the template creates the group with an `AWS::Logs::LogGroup` resource and the
function depends on it. The group name reaches the handler through
`TELEMETRY_LOG_GROUP_NAME`.

The `LambdaExecutionRoleArn` role must allow `logs:CreateLogStream` and `logs:PutLogEvents`
on the group. `AWSLambdaBasicDurableExecutionRolePolicy` grants both on `*`.

## Building locally

Prerequisites: Node ≥ 22.

```bash
# from the monorepo root
npm ci
npm run build -w @aws/durable-execution-sdk-js
npm run build -w @aws/durable-execution-sdk-js-telemetry-exporter
npm run test -w @aws/durable-execution-sdk-js-conformance-tests-telemetry    # typecheck + wiring
npm run build -w @aws/durable-execution-sdk-js-conformance-tests-telemetry   # -> dist/*.js
```

Cloud run, from a checkout of the conformance repository with the telemetry package installed:

```bash
durable-execution-conformance \
  --template <this-repo>/packages/aws-durable-execution-sdk-js-conformance-tests-telemetry/template.yaml \
  --language js --region us-west-2 --suite telemetry \
  --report console json \
  --parameter-overrides LambdaExecutionRoleArn=<role-arn>
```

## CI workflow

[`.github/workflows/telemetry-conformance-tests.yml:45–81`](../../.github/workflows/telemetry-conformance-tests.yml#L45-L81) calls the shared `telemetry-suite.yml`
workflow in `aws/aws-durable-execution-conformance-tests`. It runs on pull requests and on
pushes to `main` that change the SDK, the exporter, this package, the root dependency
files, the Node setup scripts, or the workflow. It also runs on manual dispatch, where
`aws_region` and `conformance_test_ref` can be overridden.

The workflow runs these steps in the SDK checkout:

1. `npm ci` with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`.
2. Build the SDK and the exporter.
3. `npm test` and `npm run build` for this package.

The shared workflow then deploys `template.yaml` and runs the `telemetry` suite.

### Prerequisites

- The repository secrets `TEST_ROLE_ARN`, `TEST_ACCOUNT_ID` and
  `TEST_LAMBDA_EXECUTION_ROLE_ARN` exist. The shared workflow receives them as
  `CONFORMANCE_TEST_ROLE_ARN`, `CONFORMANCE_TEST_ACCOUNT_ID` and
  `CONFORMANCE_TEST_LAMBDA_EXECUTION_ROLE_ARN`.
- The persistent stack is `conformance-tests-js-telemetry`. The test role
  must be able to create and update it and read telemetry with `logs:FilterLogEvents`. The Lambda execution role must allow
  `logs:CreateLogStream` and `logs:PutLogEvents`.
- The shared workflow owns the concurrency group for the stack. The caller declares none,
  so an active deployment is not cancelled by a newer run.
- Pull requests from forks and from Dependabot skip the job, because they cannot read secrets.

### Pinning and artifacts

The `uses:` reference is a full 40-character commit SHA of the conformance repository.
A branch or tag would let a conformance change alter this repository's CI without a pull
request here. To update it, merge the conformance change, then change the SHA in a pull request.

The shared workflow uploads JSON and JUnit reports, execution histories, and retrieved
telemetry diagnostics as an artifact on the run page. It also writes a job summary.

### Stacked pull request

The `pull_request` branch filter lists `feat/conformance-tests-telemetry` in addition to
`main`, because the workflow is first reviewed on a branch stacked on that one. After the
base pull request merges and this one is retargeted to `main`, remove that entry from the
workflow and its matching test expectation.
