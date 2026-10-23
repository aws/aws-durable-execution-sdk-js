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

A caller GitHub workflow is a follow-on; the OTel orchestrator is OTel-specific.
