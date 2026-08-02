# Workflow Studio — AWS service "job" integrations (Run-a-Job / `.sync`)

Status: **proposed** (design; implementation phased).

## Motivation

AWS Step Functions ships [optimized service integrations][sfn] with three
patterns:

- **Request/Response** — call an API, continue immediately.
- **Run a Job (`.sync`)** — start an asynchronous job and **wait until it
  finishes** (poll a describe/get API to a terminal status).
- **Wait for Callback (`.waitForTaskToken`)** — pause until a token is returned.

Our `.dar` model already covers two of the three:

| SFN pattern             | `.dar` equivalent                    |
| ----------------------- | ------------------------------------ |
| Request/Response        | `step` (or `chainInvoke` for Lambda) |
| Wait for Callback       | `callback` (`waitForCallback`)       |
| **Run a Job (`.sync`)** | **(missing)** — this doc adds it     |

The Run-a-Job pattern is a recurring "start → poll → finish" shape. Authors can
already build it by hand (a `step` to start + a `waitForCondition` to poll), but
that is boilerplate and easy to get wrong (id extraction, terminal-status set,
failure handling). We add a **composite node** that captures the pattern once
and is configured per service by a **preset registry**.

## Design

### One generic node kind: `awsJob`

Rather than a node kind per service (14+ kinds, 14 codegen branches, 14
inspectors), we add **one** kind, `awsJob`, parameterized by an `integration`
preset key plus user-supplied input:

```jsonc
{
  "id": "n3",
  "kind": "awsJob",
  "name": "runEtl",
  "integration": "glue.startJobRun", // registry key
  "startInput": "{ \"JobName\": \"my-etl\" }", // JSON or JS expr (in scope: input, upstream consts)
  "pollIntervalSeconds": 10, // optional override of the preset default
  "region": "us-east-1", // optional; defaults to Lambda's region
}
```

Everything service-specific lives in the **registry**, not in the node.

### The preset registry (shared model package)

Add `serviceIntegrations.ts` to `@aws/durable-execution-sdk-js-visual-workflow-model`
so **both** the CDK generator and the Studio consume one source of truth:

```ts
export interface ServiceIntegration {
  key: string;                 // "glue.startJobRun"
  label: string;               // "AWS Glue — Start Job Run"
  service: string;             // "glue"  (IAM prefix + client suffix)
  clientPackage: string;       // "@aws-sdk/client-glue"
  clientClass: string;         // "GlueClient"
  start: {
    command: string;           // "StartJobRunCommand"
    // path (dot) into the start result that identifies the job:
    idPath: string;            // "JobRunId"
  };
  poll: {
    command: string;           // "GetJobRunCommand"
    // how to build the poll input from { startInput, startResult, jobId }:
    inputExpr: string;         // "{ JobName: startInput.JobName, RunId: jobId }"
    statusPath: string;        // "JobRun.JobRunState"
    resultPath?: string;       // optional: what to return (default: whole poll result)
  };
  success: string[];           // ["SUCCEEDED"]
  failure: string[];           // ["FAILED","TIMEOUT","ERROR","STOPPED"]
  defaultPollSeconds: number;  // 10
  iamActions: string[];        // ["glue:StartJobRun","glue:GetJobRun"]
  notes?: string;              // caveats (endpoints, extra perms, …)
}

export const SERVICE_INTEGRATIONS: Record<string, ServiceIntegration> = { … };
```

Adding a new service ⇒ **add one entry + one codegen test**. No new code paths.

### Codegen (CDK `emitNode` — new `case "awsJob"`)

Emitted as an async IIFE so it binds to the node's result `const` like every
other operation node, and composes with `onError`/edges unchanged:

```ts
const runEtl = await (async () => {
  // 1) start the job (checkpointed)
  const started = await context.step("runEtl-start", async () => {
    const client = new GlueClient({});
    return await client.send(new StartJobRunCommand({ JobName: "my-etl" }));
  });
  const jobId = started.JobRunId;

  // 2) poll to a terminal status (no compute charge between polls)
  const final = await context.waitForCondition(
    "runEtl-wait",
    async (state) => {
      const client = new GlueClient({});
      const res = await client.send(
        new GetJobRunCommand({ JobName: "my-etl", RunId: jobId }),
      );
      return { ...state, status: res.JobRun?.JobRunState, result: res };
    },
    {
      initialState: { status: "STARTING", result: null },
      waitStrategy: (state, attempt) => ({
        // stop once terminal; keep polling otherwise
        shouldContinue:
          !["SUCCEEDED"].includes(state.status) &&
          !["FAILED", "TIMEOUT", "ERROR", "STOPPED"].includes(state.status),
        delay: { seconds: 10 },
      }),
    },
  );

  // 3) fail the node if the job failed
  if (["FAILED", "TIMEOUT", "ERROR", "STOPPED"].includes(final.status)) {
    throw new Error(`runEtl failed: ${final.status}`);
  }
  return final.result;
})();
```

Notes:

- The SDK client + `.send` run **inside** `step`/`waitForCondition` bodies, so
  no durable op nests inside a step (SDK rule) and all AWS calls are
  checkpointed / replay-safe.
- Uses AWS SDK **v3** (`@aws-sdk/client-*`), consistent with the rest of the
  project; deploy/CDK already mark `@aws-sdk/*` external.
- We reuse the first-class `stopCondition` mechanism where convenient, but the
  emitted `shouldContinue` above is self-contained.

### Timeout inference

`timeout.ts` should treat an `awsJob` like a `waitForCondition` with an unknown
budget: contribute a conservative fixed budget (e.g. `defaultPollSeconds ×
maxAttempts`, or a per-preset `maxWaitSeconds`) to the longest-path timeout.

### Permission analysis

`analyzeWorkflowPermissions` already walks nodes. Add: for an `awsJob`, emit the
preset's `iamActions` (resources `*`, tightened later). This is pure data from
the registry.

### Studio UX

The palette gains a **"Jobs"** section that lists **one entry per integration**
(Glue, Batch, CodeBuild, Athena, …), so each service reads as its own node type
with its own label, icon and color. Under the hood every entry creates the same
`awsJob` kind with its `integration` preset key pre-filled — distinct node types
in the UI, one codegen path underneath.

- **Palette:** a "Jobs" group, generated from `SERVICE_INTEGRATIONS` (each preset
  = one draggable node type). Dragging "AWS Glue — Start Job Run" creates
  `{ kind: "awsJob", integration: "glue.startJobRun", … }`.
- **Inspector (`NodeInspector`):** when `kind === "awsJob"`:
  - the chosen integration is shown (and switchable via a Select of the same
    registry, grouped by service),
  - a `CodeField` for `startInput` (JSON/JS; the Agent button can generate it),
  - number field for `pollIntervalSeconds` (placeholder = preset default),
  - read-only preset summary (start/poll APIs, terminal states, IAM) so the
    author sees what will run,
  - optional `region`.
- **Graph/coloring:** `awsJob` nodes render with a per-service label/glyph
  (from the preset) and a shared "Jobs" color family. Read-only `ExecutionGraph`
  renders the two underlying ops (`<name>-start`, `<name>-wait`) when overlaying
  a live run.

### Model plumbing / migration

- Add `"awsJob"` to `DAR_NODE_KINDS` (shared) — the single edit both packages
  inherit.
- Extend `DAR_JSON_SCHEMA` with the `awsJob` fields.
- `migrateDar` needs no change (additive kind); unknown-kind handling stays.
- `createNode` (Studio) seeds defaults (first preset, empty `startInput`).

### Testing

- **CDK:** a codegen test per preset (snapshot of the emitted start/poll block)
  - a transpile check; extend `analyzePermissions.test.ts` with the preset's
    actions. The agent dry-run harness already exercises generated handlers.
- **Shared:** a registry sanity test (every entry has non-empty required fields,
  keys match `service.command` convention, `iamActions` prefixed by `service`).
- **Studio:** `studioModel` create/parse round-trip for `awsJob`.

## Integration inventory (from the SFN optimized-integrations table)

Only **Run-a-Job (`.sync`)** services get an `awsJob` preset. Grouped by
implementation difficulty:

### Tier 1 — clean start → poll (do first) — ✅ implemented

| Preset key                   | Start API           | id               | Poll API          | Status path                   |
| ---------------------------- | ------------------- | ---------------- | ----------------- | ----------------------------- |
| `glue.startJobRun`           | StartJobRun         | JobRunId         | GetJobRun         | JobRun.JobRunState            |
| `batch.submitJob`            | SubmitJob           | jobId            | DescribeJobs      | jobs[0].status                |
| `codebuild.startBuild`       | StartBuild          | build.id         | BatchGetBuilds    | builds[0].buildStatus         |
| `athena.startQueryExecution` | StartQueryExecution | QueryExecutionId | GetQueryExecution | QueryExecution.Status.State   |
| `sfn.startExecution`         | StartExecution      | executionArn     | DescribeExecution | status                        |
| `ecs.runTask`                | RunTask             | tasks[0].taskArn | DescribeTasks     | tasks[0].lastStatus (STOPPED) |

### Tier 2 — same shape, more fields / multiple operations — ✅ implemented

| Preset key                      | Notes                                                    |
| ------------------------------- | -------------------------------------------------------- |
| `databrew.startJobRun`          | DescribeJobRun → State                                   |
| `emrServerless.startJobRun`     | GetJobRun → jobRun.state                                 |
| `emrContainers.startJobRun`     | DescribeJobRun → jobRun.state (EMR on EKS)               |
| `emr.addJobFlowSteps`           | DescribeStep → Step.Status.State (IAM: elasticmapreduce) |
| `sagemaker.createTrainingJob`   | DescribeTrainingJob → TrainingJobStatus                  |
| `sagemaker.createTransformJob`  | DescribeTransformJob → TransformJobStatus                |
| `sagemaker.createProcessingJob` | DescribeProcessingJob → ProcessingJobStatus              |

### Tier 3 — special handling (endpoint / non-standard) — partially implemented

| Preset key                            | Status / caveat                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `mediaconvert.createJob`              | ✅ implemented; requires an account-specific endpoint.                           |
| `bedrock.createModelCustomizationJob` | ✅ implemented (model customization job).                                        |
| `eks.runJob`                          | ❌ omitted — drives the Kubernetes API, not a single AWS SDK start/poll command. |

**Request/Response-only** services (API Gateway, DynamoDB, SNS, SQS,
EventBridge, Lambda, Bedrock AgentCore) need **no** composite node — a plain
`step` (or `chainInvoke`) already covers them. We may later add lightweight
single-call "service action" presets, but that is out of scope here.

## Phased implementation plan

- **Phase 0 — foundation (must land first):** ✅ done — shared registry (with
  `glue.startJobRun`), `awsJob` kind + schema, CDK codegen + timeout + permission
  analysis, Studio "Jobs" palette + inspector + colors, and tests.
- **Phase 1 — Tier 1 presets:** ✅ done — batch, codebuild, athena, sfn, ecs
  (each with a per-preset codegen/transpile test).
- **Phase 2 — Tier 2 presets.** ✅ done (DataBrew, EMR family, SageMaker).
- **Phase 3 — Tier 3 presets.** ✅ MediaConvert + Bedrock; EKS runJob omitted.

## Deployment verification

All 15 presets were deployed to a live account via the `DurableWorkflowFunction`
CDK construct (one function per preset; scratch app under `deploy-verify/`).
Confirmed in-account:

- 15 `nodejs22.x` durable functions, each with `DurableConfig` (per-preset
  inferred `ExecutionTimeout` matching the registry `maxWaitSeconds` +20%) and
  the `AWSLambdaBasicDurableExecutionRolePolicy` managed policy.
- Inferred inline IAM matches each preset (e.g. `glue:StartJobRun`/`GetJobRun`;
  EMR correctly uses the `elasticmapreduce:` prefix, not `emr:`).
- The `workflowStudioDar` tag + embedded `.dar` are present.

Each preset after Phase 0 is a small, mostly-data change → ideal for a subagent
per service.

[sfn]: https://docs.aws.amazon.com/step-functions/latest/dg/integrate-optimized.html
