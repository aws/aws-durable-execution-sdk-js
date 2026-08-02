/**
 * `.dar` workflow for the "JobStatusPoller" Step Functions starter pack.
 * Hand-authored (not machine-imported) following the same convention as
 * `taskTimer.dar.template.ts` / `waitForCallback.dar.template.ts` - see
 * `helloLambda.dar.template.ts`'s header for the general "why hand-author,
 * not import" rationale.
 *
 * New structural pattern this pack exercises (TaskTimer/WaitForCallback had
 * none): ASL's `Wait X Seconds` -> `Get Job Status` -> `Job Complete?` ->
 * (loop back to `Wait X Seconds`, or exit to `Job Failed`/`Get Final Job
 * Status`) is a POLLING LOOP. It is NOT representable as a cycle of `.dar`
 * nodes: `emitChain` in `generateHandler.ts` tracks a `visited` set
 * specifically to prevent node cycles - a node revisited via a loop-back edge
 * is silently dropped from the chain (see that function's docstring). The
 * only valid translation is to collapse the entire Wait+Task+Choice loop into
 * a SINGLE `waitForCondition` node: its `code` callback IS the loop body
 * (check the job, return updated state), and its `wait`/`stopCondition`
 * config IS the loop's wait-and-recheck-exit-condition, all handled by the
 * SDK's own polling primitive instead of a graph cycle.
 *
 * "Submit Job" is deliberately kept as its own `step` node BEFORE the
 * `waitForCondition`, rather than folded into the waitForCondition's `code`
 * callback: submission must happen exactly once, but a waitForCondition's
 * callback re-runs on every poll attempt (that's the whole point of the
 * primitive - it's the polling body). Emitting the submit call inside it
 * would resubmit a new Batch job on every single poll iteration. A
 * preceding `step` checkpoints the submission once; `waitForCondition`'s
 * `initialState` then seeds the poll loop from that step's result.
 *
 * Structure (mirrors the ASL's 5 states, collapsed to 5 `.dar` nodes):
 *   start -> Submit_Job (step, invokes SubmitJobFunction once)
 *         -> Poll_Job_Status (waitForCondition: seeds from Submit_Job's
 *            jobId + status "RUNNING"; each poll attempt invokes
 *            CheckJobFunction and returns the updated status; stops polling
 *            once status is SUCCEEDED or FAILED)
 *         -> Job_Complete (condition: switches on Poll_Job_Status's final
 *            .status - the ASL Choice state's direct equivalent)
 *              match "FAILED"    -> Job_Failed (end, endMode "throw" - ASL's
 *                                   Fail state)
 *              match "SUCCEEDED" -> Get_Final_Job_Status (step: re-invokes
 *                                   CheckJobFunction once more for the final
 *                                   payload, matching the ASL's redundant
 *                                   final check) -> Success (end, default
 *                                   return mode)
 * `dependencyMode: "dag"` (not "linear") because Job_Complete fans out to two
 * targets - see `condition.test.ts` for the same pattern.
 *
 * Every embedded code string below uses string concatenation (`"a" + b +
 * "c"`) instead of template literals for anything that needs to reference a
 * value at generated-handler runtime, so this outer `.dar.template.ts`
 * template literal never has to escape a nested `${...}` - the established
 * lesson from HelloLambda's real verification run (nested template-literal
 * escaping is a reliable source of subtle corruption).
 *
 * Lambda invoke responses are decoded with a plain `JSON.parse(response.Payload)`
 * - `generateHandler.ts`'s `fixLambdaPayloadDecoding` rewrites that pattern to
 * decode the underlying `Uint8Array` via `TextDecoder` automatically, so
 * hand-written code must NOT add its own `TextDecoder` call (that would no
 * longer match the rewrite's regex and would double-decode).
 */

const DAR_TEMPLATE = `{
  "darVersion": "1.0",
  "name": "JobStatusPoller",
  "dependencyMode": "dag",
  "nodes": [
    {
      "id": "start",
      "kind": "start",
      "name": "Start",
      "position": { "x": 40, "y": 0 }
    },
    {
      "id": "Submit_Job",
      "name": "Submit Job",
      "position": { "x": 40, "y": 150 },
      "kind": "step",
      "code": "const { LambdaClient, InvokeCommand } = require(\\"@aws-sdk/client-lambda\\");\\n\\nconst lambdaClient = new LambdaClient({ region: \\"{{REGION}}\\" });\\n\\nconst response = await lambdaClient.send(\\n  new InvokeCommand({\\n    FunctionName: \\"{{SUBMIT_JOB_FUNCTION_ARN}}\\",\\n    Payload: JSON.stringify({\\n      jobName: (input as { jobName?: string })?.jobName ?? \\"my-job\\",\\n      jobQueue: (input as { jobQueue?: string })?.jobQueue ?? \\"{{JOB_QUEUE_ARN}}\\",\\n      jobDefinition: (input as { jobDefinition?: string })?.jobDefinition ?? \\"{{JOB_DEFINITION}}\\",\\n    }),\\n  }),\\n);\\n\\nconst result = JSON.parse(response.Payload);\\n\\nreturn { jobId: result.jobId };"
    },
    {
      "id": "Poll_Job_Status",
      "name": "Poll Job Status",
      "position": { "x": 40, "y": 300 },
      "kind": "waitForCondition",
      "initialState": "{ \\"jobId\\": Submit_Job.jobId, \\"status\\": \\"RUNNING\\" }",
      "code": "const { LambdaClient, InvokeCommand } = require(\\"@aws-sdk/client-lambda\\");\\n\\nconst lambdaClient = new LambdaClient({ region: \\"{{REGION}}\\" });\\n\\nconst response = await lambdaClient.send(\\n  new InvokeCommand({\\n    FunctionName: \\"{{CHECK_JOB_FUNCTION_ARN}}\\",\\n    Payload: JSON.stringify({ jobId: state.jobId }),\\n  }),\\n);\\n\\nconst status = JSON.parse(response.Payload);\\n\\nreturn { ...state, status };",
      "stopCondition": "state.status === 'SUCCEEDED' || state.status === 'FAILED'",
      "wait": {
        "kind": "linear",
        "maxAttempts": 30,
        "initialDelaySeconds": 10,
        "incrementSeconds": 0,
        "maxDelaySeconds": 10,
        "jitter": "NONE"
      }
    },
    {
      "id": "Job_Complete",
      "name": "Job Complete?",
      "position": { "x": 40, "y": 450 },
      "kind": "condition",
      "code": "return Poll_Job_Status.status;"
    },
    {
      "id": "Job_Failed",
      "name": "Job Failed",
      "position": { "x": 300, "y": 600 },
      "kind": "end",
      "endMode": "throw",
      "code": "throw new Error(\\"AWS Batch Job Failed: DescribeJob returned FAILED\\");"
    },
    {
      "id": "Get_Final_Job_Status",
      "name": "Get Final Job Status",
      "position": { "x": 40, "y": 600 },
      "kind": "step",
      "code": "const { LambdaClient, InvokeCommand } = require(\\"@aws-sdk/client-lambda\\");\\n\\nconst lambdaClient = new LambdaClient({ region: \\"{{REGION}}\\" });\\n\\nconst response = await lambdaClient.send(\\n  new InvokeCommand({\\n    FunctionName: \\"{{CHECK_JOB_FUNCTION_ARN}}\\",\\n    Payload: JSON.stringify({ jobId: Poll_Job_Status.jobId }),\\n  }),\\n);\\n\\nreturn JSON.parse(response.Payload);"
    },
    {
      "id": "Success",
      "name": "Success",
      "position": { "x": 40, "y": 750 },
      "kind": "end",
      "endMode": "return",
      "code": "return { jobId: Poll_Job_Status.jobId, status: Get_Final_Job_Status };"
    }
  ],
  "edges": [
    { "id": "e0_start_Submit_Job", "source": "start", "target": "Submit_Job" },
    { "id": "e1_Submit_Job_Poll_Job_Status", "source": "Submit_Job", "target": "Poll_Job_Status" },
    { "id": "e2_Poll_Job_Status_Job_Complete", "source": "Poll_Job_Status", "target": "Job_Complete" },
    { "id": "e3_Job_Complete_Job_Failed", "source": "Job_Complete", "target": "Job_Failed", "match": "FAILED" },
    { "id": "e4_Job_Complete_Get_Final_Job_Status", "source": "Job_Complete", "target": "Get_Final_Job_Status", "match": "SUCCEEDED" },
    { "id": "e5_Get_Final_Job_Status_Success", "source": "Get_Final_Job_Status", "target": "Success" }
  ]
}`;

export interface JobStatusPollerDarContext {
  region: string;
  submitJobFunctionArn: string;
  checkJobFunctionArn: string;
  jobQueueArn: string;
  jobDefinition: string;
}

/** Fills in the .dar template's placeholders from a deployed CFN stack's outputs. */
export function resolveJobStatusPollerDar(
  ctx: JobStatusPollerDarContext,
): string {
  return DAR_TEMPLATE.replace(/\{\{REGION\}\}/g, ctx.region)
    .replace(/\{\{SUBMIT_JOB_FUNCTION_ARN\}\}/g, ctx.submitJobFunctionArn)
    .replace(/\{\{CHECK_JOB_FUNCTION_ARN\}\}/g, ctx.checkJobFunctionArn)
    .replace(/\{\{JOB_QUEUE_ARN\}\}/g, ctx.jobQueueArn)
    .replace(/\{\{JOB_DEFINITION\}\}/g, ctx.jobDefinition);
}

export default DAR_TEMPLATE;
