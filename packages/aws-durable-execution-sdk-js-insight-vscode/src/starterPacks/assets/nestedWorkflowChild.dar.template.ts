/**
 * `.dar` workflow for the CHILD half ("NestingPatternAnotherStateMachine")
 * of the "NestedWorkflow" Step Functions starter pack. Hand-authored (not
 * machine-imported) following the same convention as
 * `eventBridgeCustomEvent.dar.template.ts` / `waitForCallback.dar.template.ts` /
 * `jobStatusPoller.dar.template.ts` - see `helloLambda.dar.template.ts`'s
 * header for the general "why hand-author, not import" rationale.
 *
 * STRUCTURALLY DIFFERENT from every prior pack in this repo: "NestedWorkflow"
 * is not a single durable function backed by supporting AWS resources
 * (SQS/SNS/DynamoDB/Batch) - it's TWO separate durable Lambda functions (this
 * CHILD, and `nestedWorkflowParent.dar.template.ts`'s PARENT) that call each
 * other directly via Lambda's own invoke APIs. There is deliberately NO
 * `nestedWorkflowChild.cfn.yaml.ts` / `nestedWorkflowParent.cfn.yaml.ts` file
 * for this pack, unlike every other pack so far: the source ASL's nesting
 * pattern is fundamentally about state-machine-to-state-machine composition,
 * not about integrating with any other AWS service - the durable-Lambda
 * translation of "start another state machine" is simply "invoke another
 * durable Lambda function" (via `@aws-sdk/client-lambda`'s `InvokeCommand`,
 * or the SDK's own `context.invoke`/`chainInvoke` for the synchronous case -
 * see `nestedWorkflowParent.dar.template.ts`'s header). There is nothing to
 * provision beyond the two durable Lambda functions themselves, which deploy
 * directly via the existing `deployWorkflow()` Studio flow - no supporting
 * CFN stack, no CFN Outputs to resolve placeholders from.
 *
 * This CHILD is entirely self-contained: unlike every prior pack's `.dar`,
 * it needs NO placeholders resolved from a deployed stack's outputs at all
 * (its `NestedWorkflowChildDarContext` is empty - see below). It must be
 * deployed FIRST; its resulting qualified function ARN is then threaded into
 * the PARENT's `{{CHILD_FUNCTION_ARN}}` placeholder by whatever orchestrates
 * both deploys (a separate concern from this template).
 *
 * Callback semantics (re-confirmed per `waitForCallback.dar.template.ts`'s
 * header before writing this): when invoked with `NeedCallback: true`, this
 * CHILD calls back to the PARENT's own `context.waitForCallback` using
 * Lambda's `SendDurableExecutionCallbackSuccessCommand` (from
 * `@aws-sdk/client-lambda`) - NOT Step Functions' `SendTaskSuccessCommand`,
 * which is what the source ASL's `Callback` state literally invokes
 * (`aws-sdk:sfn:sendTaskSuccess`) but which has no meaning for a durable
 * Lambda function. The PARENT's callback id is threaded through as part of
 * this CHILD's own invocation payload (`input.ParentCallbackId`) - the
 * durable-Lambda equivalent of the ASL's `TaskToken` being threaded through
 * `Execution.Input.TaskToken`.
 *
 * UPDATE: the condition-branch-convergence limitation described in the
 * paragraph above has since been FIXED at the source
 * (`@aws/durable-execution-sdk-js-cdk`'s `generateHandler.ts`/`emitChain` now
 * gives each condition branch its own copy of `visited`, so branches that
 * legitimately reconverge on a shared downstream node - as ASL's own Choice
 * state does here, with both the "YES"/Callback path and the Default path
 * eventually reaching the same `Second long-running job` / `Report
 * completion` states - correctly emit that shared node's code into EVERY
 * branch that reaches it, not just the first one processed). This template
 * has been updated accordingly: `Second_Long_Running_Job`/`Report_Completion`
 * are now single, shared `.dar` nodes reached from BOTH the "YES" and "NO"
 * branches (matching the ASL exactly - one wait, one Pass state, not two),
 * rather than the duplicated-node workaround an earlier draft of this file
 * used before the codegen bug was found and fixed.
 *
 * `input` is referenced directly (not a named upstream node's result) for
 * `Need_Callback`'s condition code even though it is NOT the first node
 * after `start` - `First_Long_Running_Job` is - because `wait` nodes do not
 * bind a result (confirmed against `generateHandler.ts`'s `bindsResult()`:
 * returns `false` for `wait`/`start`/`end`), so there is no
 * `First_Long_Running_Job` identifier to reference; `input` (the handler's
 * own top-level invocation payload) remains the only, and correct,
 * reference.
 *
 * Structure (mirrors the ASL's 6 states exactly, 6 `.dar` nodes):
 *   start -> First_Long_Running_Job (wait, 1 second - ASL's "First
 *            long-running job")
 *         -> Need_Callback (condition: `input.NeedCallback ? "YES" : "NO"` -
 *            the ASL Choice state's direct equivalent)
 *              match "YES" -> Callback (step: sends a durable-execution
 *                 callback success to the PARENT via
 *                 `SendDurableExecutionCallbackSuccessCommand`, `CallbackId:
 *                 input.ParentCallbackId`, `Result` matching the ASL
 *                 Callback state's `Output` literal verbatim)
 *                 -> Second_Long_Running_Job (shared with the "NO" branch
 *                 below - wait, 1 second - ASL's "Second long-running job")
 *              default/"NO" -> Second_Long_Running_Job (same shared node)
 *         -> Report_Completion (shared terminal, reached from
 *            Second_Long_Running_Job regardless of which condition branch
 *            was taken - end, terminal: returns the ASL Pass state's
 *            `Output` literal verbatim)
 * `dependencyMode: "dag"` (the condition node fans out to two branches that
 * reconverge).
 */

const DAR_TEMPLATE = `{
  "darVersion": "1.0",
  "name": "NestedWorkflowChild",
  "dependencyMode": "dag",
  "nodes": [
    {
      "id": "start",
      "kind": "start",
      "name": "Start",
      "position": { "x": 40, "y": 0 }
    },
    {
      "id": "First_Long_Running_Job",
      "name": "First Long Running Job",
      "position": { "x": 40, "y": 150 },
      "kind": "wait",
      "durationValue": 1,
      "durationUnit": "seconds"
    },
    {
      "id": "Need_Callback",
      "name": "Need Callback?",
      "position": { "x": 40, "y": 300 },
      "kind": "condition",
      "code": "return input.NeedCallback ? \\"YES\\" : \\"NO\\";"
    },
    {
      "id": "Callback",
      "name": "Callback",
      "position": { "x": 40, "y": 450 },
      "kind": "step",
      "code": "const { LambdaClient, SendDurableExecutionCallbackSuccessCommand } = require(\\"@aws-sdk/client-lambda\\");\\n\\nconst lambdaClient = new LambdaClient({ region: \\"{{REGION}}\\" });\\n\\nawait lambdaClient.send(\\n  new SendDurableExecutionCallbackSuccessCommand({\\n    CallbackId: input.ParentCallbackId,\\n    Result: Buffer.from(\\n      JSON.stringify(\\n        \\"Callback right after the first long-running job is completed\\",\\n      ),\\n    ),\\n  }),\\n);\\n\\nreturn { sentCallback: true };"
    },
    {
      "id": "Second_Long_Running_Job",
      "name": "Second Long Running Job",
      "position": { "x": 40, "y": 600 },
      "kind": "wait",
      "durationValue": 1,
      "durationUnit": "seconds"
    },
    {
      "id": "Report_Completion",
      "name": "Report Completion",
      "position": { "x": 40, "y": 750 },
      "kind": "end",
      "endMode": "return",
      "code": "return \\"The whole execution is completed including both long-running jobs\\";",
      "terminal": true
    }
  ],
  "edges": [
    { "id": "e0_start_First_Long_Running_Job", "source": "start", "target": "First_Long_Running_Job" },
    { "id": "e1_First_Long_Running_Job_Need_Callback", "source": "First_Long_Running_Job", "target": "Need_Callback" },
    { "id": "e2_Need_Callback_Callback", "source": "Need_Callback", "target": "Callback", "match": "YES" },
    { "id": "e3_Callback_Second_Long_Running_Job", "source": "Callback", "target": "Second_Long_Running_Job" },
    { "id": "e4_Need_Callback_Second_Long_Running_Job", "source": "Need_Callback", "target": "Second_Long_Running_Job" },
    { "id": "e5_Second_Long_Running_Job_Report_Completion", "source": "Second_Long_Running_Job", "target": "Report_Completion" }
  ]
}`;

export interface NestedWorkflowChildDarContext {
  region: string;
}

/**
 * Fills in the .dar template's placeholders. Unlike every other pack's
 * resolver, this CHILD needs no CFN stack outputs - it is entirely
 * self-contained (`{{REGION}}` is the only placeholder, sourced from the
 * caller's deploy target region, not from any deployed infra).
 */
export function resolveNestedWorkflowChildDar(
  ctx: NestedWorkflowChildDarContext,
): string {
  return DAR_TEMPLATE.replace(/\{\{REGION\}\}/g, ctx.region);
}

export default DAR_TEMPLATE;
