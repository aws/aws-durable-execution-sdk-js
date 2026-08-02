/**
 * `.dar` workflow for the PARENT half ("NestingPatternMainStateMachine") of
 * the "NestedWorkflow" Step Functions starter pack. Hand-authored (not
 * machine-imported) - see `nestedWorkflowChild.dar.template.ts`'s header for
 * this pack's overall rationale (two separate durable Lambda functions, no
 * CFN infra) and this PARENT's own header notes below for what's specific to
 * it.
 *
 * Same "no CFN infra" note as the CHILD: there is deliberately NO
 * `nestedWorkflowParent.cfn.yaml.ts` file. The only "infra" this PARENT
 * depends on is the CHILD's own deployed, qualified function ARN
 * (`{{CHILD_FUNCTION_ARN}}`) - the CHILD must be deployed FIRST via its own
 * `.dar.template.ts` + Studio's `deployWorkflow()`, and its resulting ARN
 * (e.g. `arn:aws:lambda:<region>:<account>:function:workflow-studio-
 * nestedworkflowchild-poc:live`) is threaded into this template by whatever
 * orchestrates both deploys (a separate concern from this template - see
 * `NestedWorkflowParentDarContext` below).
 *
 * Translates the ASL's 3 Step-Functions-composition patterns
 * (`states:startExecution` variants) directly onto this SDK's own
 * Lambda-composition primitives, one per pattern:
 *
 *  1. **Fire-and-continue** (ASL's plain, non-`.sync` `startExecution`):
 *     there is NO fire-and-forget equivalent to `chainInvoke`/
 *     `context.invoke()` in this SDK (that primitive always awaits
 *     synchronously - see note 2 below). The correct translation is a plain
 *     `step` node whose code calls `@aws-sdk/client-lambda`'s
 *     `InvokeCommand` directly with `InvocationType: "Event"` against the
 *     CHILD's ARN - this returns immediately without waiting for the CHILD
 *     to finish, exactly matching ASL's plain `startExecution` (starts the
 *     other execution and moves on to `Next` without waiting for it).
 *  2. **Wait-for-completion** (ASL's `startExecution.sync:2`): `.dar`'s
 *     `chainInvoke` node (`context.invoke()`) is a direct match - confirmed
 *     against `generateHandler.ts`'s `case "chainInvoke":`, it ALWAYS awaits
 *     the invoked function's full completion synchronously, which is
 *     exactly `.sync`'s semantics. Used inside the "Wait For Completion"
 *     parallel branch.
 *  3. **Wait-for-callback** (ASL's `startExecution.waitForTaskToken`): a
 *     `callback` node (`context.waitForCallback`) whose `submitterCode`
 *     invokes the CHILD (again via a raw `InvokeCommand` with
 *     `InvocationType: "Event"` - the CHILD's own execution, once started,
 *     is what eventually calls back, not this submit call itself, so it
 *     must not block) with `NeedCallback: true` and this PARENT's own
 *     `callbackId` threaded through as `ParentCallbackId` in the payload -
 *     the durable-Lambda equivalent of the ASL's `TaskToken` being threaded
 *     through `Execution.Input.TaskToken`. The CHILD's own workflow (see
 *     `nestedWorkflowChild.dar.template.ts`) is what completes this
 *     callback, via `SendDurableExecutionCallbackSuccessCommand` - NOT Step
 *     Functions' `SendTaskSuccessCommand` (the callback-semantics-mismatch
 *     lesson from `waitForCallback.dar.template.ts`'s header, re-confirmed
 *     here since this is the second pack in this repo using callbacks).
 *     Used inside the "Wait For Callback" parallel branch.
 *
 * ASL's top-level `Parallel` state (`Start in parallel`, 2 branches) -> a
 * `.dar` `parallel` node (`context.parallel()`), each branch's own nested
 * `body` a full self-contained `.dar` sub-workflow (own start/nodes/edges),
 * the same nesting pattern as `map`'s `body` in
 * `dynamicParallelProcessing.dar.template.ts`. Each branch body's last node
 * is marked `"terminal": true` rather than an explicit `"end"`-kind node -
 * confirmed against that same pack's map-body convention (a container body's
 * last operation node's own bound result becomes that branch's output,
 * needing no separate return statement).
 *
 * REAL LESSON applied here from `dynamicParallelProcessing.dar.template.ts`'s
 * documented `map`-node `BatchResult` bug: `context.parallel()`'s bound
 * result is likewise NOT a plain array - confirmed directly against
 * `durable-context.ts`'s own type signature, `parallel<TOutput>(...):
 * DurablePromise<BatchResult<TOutput>>` (the exact same `BatchResult<T>`
 * wrapper `map` returns - `{ all, status, completionReason, successCount,
 * failureCount, startedCount, totalCount, getResults(): TResult[],
 * getErrors(), throwIfError(), succeeded()/failed()/started() }`, see
 * `packages/aws-durable-execution-sdk-js/src/types/batch.ts`). The final
 * `Success` node therefore reads `Start_In_Parallel.getResults()` (the
 * array of each branch's own successful return value, in the SAME shape a
 * plain array would have been for this specific pack, since both branches
 * are expected to always succeed) rather than assuming `Start_In_Parallel`
 * itself is already that array.
 *
 * `input` is referenced directly for `Start_New_Workflow_And_Continue`
 * (this PARENT's first real node after `start`) since there is no upstream
 * node's bound result to reference yet - the ASL has no input-driven fields
 * at this stage either (`NeedCallback`/`AWS_STEP_FUNCTIONS_STARTED_BY_
 * EXECUTION_ID` are both static/context-derived in the source ASL, not
 * `$states.input.*`), so this template keeps `NeedCallback: false` as a
 * static literal too, faithfully matching the ASL's own `Arguments.Input`
 * for that state.
 *
 * Structure (mirrors the ASL's 2 top-level states, collapsed to 4 `.dar`
 * nodes - the ASL's own nested Parallel-branch states become 1 node each
 * inside the `parallel` node's 2 branch bodies):
 *   start -> Start_New_Workflow_And_Continue (step: fire-and-continue via
 *            `InvokeCommand`/`InvocationType: "Event"` against
 *            `{{CHILD_FUNCTION_ARN}}`, payload `{ NeedCallback: false }` -
 *            ASL's "Start new workflow and continue")
 *         -> Start_In_Parallel (parallel, 2 branches - ASL's "Start in
 *            parallel"):
 *              branch "Wait_For_Completion": start -> chainInvoke
 *                (`context.invoke()` against `{{CHILD_FUNCTION_ARN}}`,
 *                payload `{ NeedCallback: false }`, terminal: true - ASL's
 *                "Start new workflow and wait for completion")
 *              branch "Wait_For_Callback": start -> callback
 *                (`context.waitForCallback`; submitterCode invokes the
 *                CHILD via `InvokeCommand`/`InvocationType: "Event"` with
 *                `{ NeedCallback: true, ParentCallbackId: callbackId }`,
 *                5-minute timeout, terminal: true - ASL's "Start new
 *                workflow and wait for callback")
 *         -> Success (end, terminal: returns
 *            `{ results: Start_In_Parallel.getResults() }`)
 * `dependencyMode: "linear"` for the PARENT's top-level chain (start -> step
 * -> parallel -> end, no branching at the top level - only the `parallel`
 * node's own 2 branches fan out, handled by its `branches` field, not
 * top-level edges).
 *
 * Placeholders (`{{...}}`) are filled in by
 * {@link resolveNestedWorkflowParentDar} - `{{REGION}}` from the deploy
 * target region, `{{CHILD_FUNCTION_ARN}}` from the already-deployed CHILD
 * function's own qualified ARN (NOT a CFN stack output - this pack has no
 * CFN stack at all).
 */

const DAR_TEMPLATE = `{
  "darVersion": "1.0",
  "name": "NestedWorkflowParent",
  "dependencyMode": "linear",
  "nodes": [
    {
      "id": "start",
      "kind": "start",
      "name": "Start",
      "position": { "x": 40, "y": 0 }
    },
    {
      "id": "Start_New_Workflow_And_Continue",
      "name": "Start New Workflow And Continue",
      "position": { "x": 40, "y": 150 },
      "kind": "step",
      "code": "const { LambdaClient, InvokeCommand } = require(\\"@aws-sdk/client-lambda\\");\\n\\nconst lambdaClient = new LambdaClient({ region: \\"{{REGION}}\\" });\\n\\nawait lambdaClient.send(\\n  new InvokeCommand({\\n    FunctionName: \\"{{CHILD_FUNCTION_ARN}}\\",\\n    InvocationType: \\"Event\\",\\n    Payload: JSON.stringify({ NeedCallback: false }),\\n  }),\\n);\\n\\nreturn { started: true };"
    },
    {
      "id": "Start_In_Parallel",
      "name": "Start In Parallel",
      "position": { "x": 40, "y": 300 },
      "kind": "parallel",
      "branches": [
        {
          "name": "Wait_For_Completion",
          "body": {
            "darVersion": "1.0",
            "name": "Wait_For_Completion_Body",
            "dependencyMode": "linear",
            "nodes": [
              {
                "id": "body_start",
                "kind": "start",
                "name": "Start",
                "position": { "x": 40, "y": 0 }
              },
              {
                "id": "Start_New_Workflow_And_Wait_For_Completion",
                "name": "Start New Workflow And Wait For Completion",
                "position": { "x": 40, "y": 150 },
                "kind": "chainInvoke",
                "functionArn": "{{CHILD_FUNCTION_ARN}}",
                "payload": "{ \\"NeedCallback\\": false }",
                "terminal": true
              }
            ],
            "edges": [
              { "id": "be0_body_start_Start_New_Workflow_And_Wait_For_Completion", "source": "body_start", "target": "Start_New_Workflow_And_Wait_For_Completion" }
            ]
          }
        },
        {
          "name": "Wait_For_Callback",
          "body": {
            "darVersion": "1.0",
            "name": "Wait_For_Callback_Body",
            "dependencyMode": "linear",
            "nodes": [
              {
                "id": "body_start",
                "kind": "start",
                "name": "Start",
                "position": { "x": 40, "y": 0 }
              },
              {
                "id": "Start_New_Workflow_And_Wait_For_Callback",
                "name": "Start New Workflow And Wait For Callback",
                "position": { "x": 40, "y": 150 },
                "kind": "callback",
                "timeoutValue": 5,
                "timeoutUnit": "minutes",
                "submitterCode": "const { LambdaClient, InvokeCommand } = require(\\"@aws-sdk/client-lambda\\");\\n\\nconst lambdaClient = new LambdaClient({ region: \\"{{REGION}}\\" });\\n\\nawait lambdaClient.send(\\n  new InvokeCommand({\\n    FunctionName: \\"{{CHILD_FUNCTION_ARN}}\\",\\n    InvocationType: \\"Event\\",\\n    Payload: JSON.stringify({\\n      NeedCallback: true,\\n      ParentCallbackId: callbackId,\\n    }),\\n  }),\\n);",
                "terminal": true
              }
            ],
            "edges": [
              { "id": "be0_body_start_Start_New_Workflow_And_Wait_For_Callback", "source": "body_start", "target": "Start_New_Workflow_And_Wait_For_Callback" }
            ]
          }
        }
      ]
    },
    {
      "id": "Success",
      "name": "Success",
      "position": { "x": 40, "y": 450 },
      "kind": "end",
      "endMode": "return",
      "code": "return { results: Start_In_Parallel.getResults() };",
      "terminal": true
    }
  ],
  "edges": [
    { "id": "e0_start_Start_New_Workflow_And_Continue", "source": "start", "target": "Start_New_Workflow_And_Continue" },
    { "id": "e1_Start_New_Workflow_And_Continue_Start_In_Parallel", "source": "Start_New_Workflow_And_Continue", "target": "Start_In_Parallel" },
    { "id": "e2_Start_In_Parallel_Success", "source": "Start_In_Parallel", "target": "Success" }
  ]
}`;

export interface NestedWorkflowParentDarContext {
  region: string;
  /** The already-deployed CHILD function's own qualified ARN (e.g. with a `:live` alias or numbered version) — NOT a CFN stack output, since this pack has no CFN stack. */
  childFunctionArn: string;
}

/**
 * Fills in the .dar template's placeholders. `{{CHILD_FUNCTION_ARN}}` must
 * be the CHILD workflow's own already-deployed, qualified function ARN (see
 * `nestedWorkflowChild.dar.template.ts` - it must be deployed first).
 */
export function resolveNestedWorkflowParentDar(
  ctx: NestedWorkflowParentDarContext,
): string {
  return DAR_TEMPLATE.replace(/\{\{REGION\}\}/g, ctx.region).replace(
    /\{\{CHILD_FUNCTION_ARN\}\}/g,
    ctx.childFunctionArn,
  );
}

export default DAR_TEMPLATE;
