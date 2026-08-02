# Workflow Studio — permission analysis before deploy / publish

## Goal

Before a workflow is deployed (Studio) or synthesized (CDK), analyze it to infer
the **IAM permissions** its code needs, so the execution role isn't limited to
the durable-checkpoint managed policy (which makes any S3/DynamoDB/Bedrock/invoke
call fail with AccessDenied).

## What to scan

Traverse the whole `.dar` (recursively through map/group bodies, parallel branch
bodies, and `onError` fallback code) and collect:

1. **AWS SDK v3 usage** in every code field (`code`, `itemsCode`, `submitterCode`,
   `fallbackCode`, `stopCondition`): find `@aws-sdk/client-<svc>` requires/imports
   and the `new XxxCommand(...)` (or `send(new XxxCommand)`) usages.
   - Action = `<svc>:<Xxx>` where `<svc>` is the client suffix (`client-s3` -> `s3`)
     and `<Xxx>` is the command minus `Command` (`PutObjectCommand` -> `PutObject`).
   - A small **curated override map** fixes the known heuristic misses
     (e.g. `s3:ListObjectsV2` -> `s3:ListBucket`, `DeleteObjectsCommand` ->
     `s3:DeleteObject`). Unknown commands still produce a best-effort action + a
     warning so nothing is silently dropped.
2. **`chainInvoke` nodes** -> `lambda:InvokeFunction` on the target `functionArn`.
3. (Callbacks need the _external_ caller to hold send perms — noted, not added to
   the function role.)

Resources default to `"*"` (static ARN inference from code literals is unreliable);
the user reviews/edits before anything is attached.

## Where the logic lives

A pure, unit-tested analyzer in the **CDK package**
(`analyzeWorkflowPermissions(workflow): { statements: {actions, resources,
source}[]; warnings: string[] }`) — node-side, reuses the shared `.dar` model,
and consumed by **both** the Studio deploy (host imports it) and the
`DurableWorkflowFunction` construct.

Extraction: start with a **light lexical scan** (regex over code strings) plus the
override map — no per-snippet TS program. Can upgrade to a TS-AST pass later if
precision demands it.

## Applying (gated)

- **Studio deploy**: run the analyzer, show a **review modal** listing inferred
  actions/resources (editable). On confirm, attach an **inline policy** to the
  role the deploy creates. If the user supplied their own `roleArn`, do **not**
  modify it — show the statements as a checklist to add themselves.
- **CDK**: the construct adds the inferred statements to its function role via
  `addToRolePolicy`, behind a prop (e.g. `grantInferredPermissions`, default on)
  so it stays explicit and overridable.

## Phases

1. **Analyzer** (pure, no mutation): CDK package + tests. Safe to land first.
2. **Studio deploy review + attach** (confirmation-gated IAM change).
3. **CDK construct** grants inferred statements.

## Risks / decisions

- **Heuristic accuracy**: command->action is ~right but not perfect; the override
  map + a "review & edit before attach" step keep the human in the loop, and
  warnings surface anything unmapped. Never silently over- or under-grant.
- **Resources = `*`** by default is broad; acceptable for a review-gated dev tool,
  and the user can narrow in the modal. (Least-privilege inference from ARNs in
  code is a later enhancement.)
- IAM changes are mutating -> deploy path stays confirmation-gated; user-provided
  roles are never modified.
