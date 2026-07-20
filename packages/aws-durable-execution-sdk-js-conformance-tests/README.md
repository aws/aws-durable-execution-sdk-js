# Durable Execution JS SDK — Conformance Tests

Cross-SDK **conformance test handlers** for the Durable Execution JavaScript/TypeScript
SDK. These handlers are deployed as AWS Lambda functions and exercised by the
language-agnostic conformance runner
[`aws-durable-execution-conformance-tests`](https://pypi.org/project/aws-durable-execution-conformance-tests/),
which invokes each function, pulls its execution history, and asserts it matches
the shared requirement specification.

The runner and the requirement specifications (the `test-requirements/` YAML files)
are **not** in this repo — they live in
[`aws/aws-durable-execution-conformance-tests`](https://github.com/aws/aws-durable-execution-conformance-tests).
This package owns only the **JS handlers** and the **SAM templates** that wire them
to requirement IDs.

## Layout

```
handlers/
  step/                     # one .ts handler per scenario (context.step)
    step_basic.ts
    step_with_retry.ts
    ...
template_step.yaml          # SAM template: maps each handler -> requirement ID(s)
rollup.config.mjs           # bundles handlers/<suite>/*.ts -> dist/<name>.js (CJS)
```

Each SAM template is a self-contained deployment for one **suite** (operation
category). Suites are added incrementally; today this package ships `step` and
`wait`.

## How a handler maps to a requirement

The link is the `TestingMetadata.TestDescription` field on each function in the
SAM template — a list of requirement IDs the handler satisfies:

```yaml
StepBasic:
  Type: AWS::Serverless::Function
  TestingMetadata:
    TestDescription: ["1-1"] # <- requirement ID(s) in the conformance repo
  Properties:
    CodeUri: ./dist
    Handler: step_basic.handler # <- dist/step_basic.js, exported `handler`
    Role: !GetAtt DurableFunctionRole.Arn
    DurableConfig:
      RetentionPeriodInDays: 7
      ExecutionTimeout: 300
```

The runner invokes the function once per requirement ID using that requirement's
`Input`, then diffs the resulting execution history against the requirement's
`ExpectedExecutionHistory`.

## Authoring a new test case

1. **Find (or add) the requirement.** Requirement IDs and their expected history
   live in the conformance repo under `test-requirements/<suite>/<id>.yaml`. If the
   behavior isn't specified yet, propose it there first.
2. **Write the handler.** Add `handlers/<suite>/<descriptive_name>.ts` that exports
   a `handler`. Use the SDK's **real API** — never hand-roll logic to force the
   expected result. A handler that fails because the SDK is non-compliant is a
   valid, valuable outcome; that failure is the signal.

   ```ts
   import {
     DurableContext,
     withDurableExecution,
   } from "@aws/durable-execution-sdk-js";

   export const handler = withDurableExecution(
     async (event: any, context: DurableContext) => {
       return await context.step(async () => `Hello, ${event}!`);
     },
   );
   ```

   File-naming convention: descriptive `snake_case`, no numeric IDs in the filename
   (IDs live in `TestDescription`). Mirror the vocabulary of existing handlers
   (e.g. `step_replay_skips_succeeded.ts`).

3. **Register it in the template.** Add an `AWS::Serverless::Function` entry to
   `template_<suite>.yaml` with `Handler: <name>.handler` and the matching
   `TestDescription: ["<id>"]`.
4. **Rebuild and run** (below).

## Running locally

Prerequisites: Node ≥ 22, Python ≥ 3.14, the AWS SAM CLI, and AWS credentials for
an account where the Durable Execution service is available.

```bash
# 1. Build the SDK + these handlers (from the monorepo root)
npm ci
npm run build -w @aws/durable-execution-sdk-js
npm run build -w @aws/durable-execution-sdk-js-conformance-tests   # -> dist/*.js

# 2. Install the conformance runner (pinned)
pip install aws-durable-execution-conformance-tests==0.1.0

# 3. Deploy + invoke + validate one suite
cd packages/aws-durable-execution-sdk-js-conformance-tests
python -m aws_durable_execution_conformance_tests.app \
  --template template_step.yaml \
  --language js \
  --suite step \
  --name conformance-js-step-local \
  --region us-west-2 \
  --history-dir history-step \
  --report junit --report-file report-step
```

The runner deploys the template via SAM, invokes each function once per
requirement ID, and reports `PASSED` / `FAILED` / `UNCOVERED` per requirement. A
non-zero exit means at least one requirement failed.

## CI

`.github/workflows/conformance-tests.yml` runs the same flow on pull requests and
on manual dispatch, one parallel job per suite (a build matrix). It assumes AWS
credentials via OIDC using the repository's existing integration secrets.

Before deploying, CI runs `scripts/inject_execution_role.py` to point every
function at the pre-existing execution role (`TEST_LAMBDA_EXECUTION_ROLE_ARN`)
and drop the template's self-created `DurableFunctionRole` — so CI deploys
don't create IAM roles. This rewrites only CI's checkout; the checked-in
template stays self-contained for local runs.
