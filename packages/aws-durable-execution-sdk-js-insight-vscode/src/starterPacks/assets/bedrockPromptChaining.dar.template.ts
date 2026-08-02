/**
 * `.dar` workflow for the "BedrockPromptChaining" Step Functions starter
 * pack. Hand-authored (not machine-imported) following the same convention
 * as `eventBridgeCustomEvent.dar.template.ts` / `taskTimer.dar.template.ts`
 * / `waitForCallback.dar.template.ts` / `jobStatusPoller.dar.template.ts` /
 * `dynamicParallelProcessing.dar.template.ts` - see
 * `helloLambda.dar.template.ts`'s header for the general "why hand-author,
 * not import" rationale.
 *
 * NO `bedrockPromptChaining.cfn.yaml.ts` FILE, deliberately - same
 * precedent as `nestedWorkflowChild.dar.template.ts` (see that file's
 * header). The source ASL provisions exactly two resources:
 * `BedrockStateMachine` (the ASL-embedding state machine itself - gone, we
 * deploy a durable Lambda instead) and `BedrockExecutionRole` (that state
 * machine's IAM role, whose only policy - `bedrock:InvokeModel` on the
 * `amazon.nova-lite-v1:0` foundation model - has no remaining consumer once
 * the state machine is gone). Once both are removed there is NOTHING left
 * to provision: no Lambda, no SQS, no SNS, no DynamoDB, no VPC - just a
 * Bedrock foundation-model invocation, which is not a CloudFormation
 * resource at all. `amazon.nova-lite-v1:0` model access is an account-level
 * Bedrock setting (model-access must be requested/granted once per account,
 * outside of any CFN stack), and the durable Lambda's own IAM permissions
 * (needing that same `bedrock:InvokeModel` action) are auto-inferred and
 * attached by the existing `deployWorkflow()` flow, not by a template. A
 * template with an empty `Resources:` block would be invalid CFN anyway
 * (`Resources` is a required, non-empty top-level key) - rather than pad it
 * out with a meaningless placeholder resource (e.g. an unused
 * `AWS::CloudFormation::WaitConditionHandle`) just to have a file, this pack
 * skips the CFN file entirely, exactly matching NestedWorkflow's precedent
 * for "no CFN infra needed when there's nothing real to provision".
 *
 * STRUCTURAL TRANSLATION - the interesting part of this pack. The source
 * ASL is a variable-length SEQUENTIAL loop: `Initialize` (Pass) seeds
 * `counter`/`conversation_history`/`input_prompts`, `Has Prompt?` (Choice)
 * branches on `counter > 0` back into `Invoke model with prompt` (Task) or
 * out to `Success` (Succeed), and the Task both calls Bedrock AND decrements
 * `counter` / appends to `conversation_history` before looping back to
 * `Has Prompt?` - a classic "Choice state pointing back upstream" ASL
 * looping idiom, repeated exactly `input.prompts.length` times (a count
 * determined by the CALLER's input, not fixed at author time).
 *
 * The `.dar` model has NO loop/repeat/cycle node kind at all -
 * `DAR_NODE_KINDS` in `@aws/durable-execution-sdk-js-visual-workflow-model`'s
 * `kinds.ts` is a closed set: `start, step, inline, wait, callback,
 * chainInvoke, waitForCondition, condition, map, group, parallel, awsJob,
 * awsSdkCall, end`. Every node kind that superficially looks like it could
 * "loop" was considered and ruled out:
 *
 *   - `condition` edges CAN point back to an already-visited node (that's
 *     exactly how `Has Prompt?` -> `Invoke model with prompt` -> (back to)
 *     `Has Prompt?` works in the ASL), but `.dar`'s codegen
 *     (`generateHandler.ts`'s `emitChain`) walks the node graph with a
 *     `visited` set per branch to EMIT CODE ONCE per node reachable from a
 *     given start - it is a graph-to-straight-line-code compiler, not a
 *     runtime loop construct. A cycle in the `.dar` graph does not compile
 *     to a runtime loop; it either infinite-loops the codegen walk or (if
 *     the walker guards against revisits, as it does) simply never re-emits
 *     the already-visited node, silently dropping the loop-back edge's
 *     semantics. There is no way to express "repeat this subgraph N times,
 *     N determined at runtime from input" via `.dar` node/edge structure.
 *   - `context.map()` (the `.dar` `map` node) fans out to independent,
 *     PARALLEL branches by design - it has no mechanism for branch i's input
 *     to depend on branch i-1's OUTPUT. Prompt chaining is the opposite: by
 *     definition, prompt i's user message is `<response to prompt i-1>.
 *     <prompt i>` - a hard sequential data dependency between iterations.
 *     `map` does not fit.
 *   - `waitForCondition` is designed for polling-with-backoff (repeatedly
 *     check some external state, waiting between attempts, until a
 *     condition holds or a timeout/attempt-limit is hit) - see
 *     `jobStatusPoller.dar.template.ts`. This pack's loop has no "wait
 *     between attempts" semantics at all (the ASL loops immediately,
 *     Task-to-Choice-to-Task, no Wait state anywhere) and is not
 *     condition-driven in that sense - it just runs exactly
 *     `prompts.length` times. Forcing it through `waitForCondition` would
 *     be a worse fit than the chosen translation, not a better one.
 *
 * CONCLUSION: the only faithful, correct translation is ONE `step` node
 * ("Chain_Prompts") whose `code` contains a plain JavaScript `for` loop,
 * calling `@aws-sdk/client-bedrock-runtime`'s `InvokeModelCommand`
 * sequentially inside that single step, accumulating `conversationHistory`
 * as a local JS array within that one step's closure - exactly the
 * "PLAIN JAVASCRIPT for LOOP inside one step" pattern AGENTS.md's own
 * "GenAI Agent (Agentic Loop)" example documents for model-invoking loops in
 * this SDK. One deliberate difference from that AGENTS.md example: its loop
 * is UNBOUNDED/agentic (the model itself decides when to stop, by returning
 * no further tool call) and puts each model invoke in ITS OWN step, so a
 * crash mid-loop only re-does the one in-flight invoke, not the whole
 * conversation so far - the right trade-off for a loop that could run for
 * many iterations. This pack's loop is BOUNDED by `input.prompts.length`
 * (from the ASL's own sample input, exactly 3) and completes in a handful of
 * real Bedrock API calls, so bundling the entire chain into one step is a
 * reasonable, deliberate simplification for a POC-scale starter pack, not a
 * shortcut taken carelessly.
 *
 * KNOWN BEHAVIORAL DIFFERENCE FROM THE SOURCE ASL, worth stating plainly
 * rather than papering over: in the ASL, each `Invoke model with prompt`
 * Task is its own checkpoint - if the state machine fails after prompt 2 of
 * 3 has been answered, a redrive resumes at `Has Prompt?` with prompts 1-2
 * already durably recorded in `conversation_history`, and only re-invokes
 * Bedrock for the remaining prompt. In this `.dar` translation, the entire
 * chain is ONE step, hence ONE checkpoint: if the durable function crashes
 * or is retried partway through the `for` loop, the WHOLE loop restarts from
 * scratch on replay, and Bedrock gets RE-INVOKED for every prompt already
 * completed (including the ones whose responses were already obtained) -
 * not just the remaining ones. This means real, duplicate Bedrock API
 * costs/calls on any mid-chain retry, unlike the ASL's per-Task granularity.
 * Acceptable for a POC-scale starter pack (3 short prompts, a few seconds of
 * total model latency) but a real production translation of a
 * longer/costlier prompt chain should likely split each Bedrock invocation
 * into its OWN named step (e.g. `context.step(\`invoke-prompt-\${i}\`, ...)`
 * in a real handler, not a `.dar` node) for per-invocation checkpointing -
 * not possible to express as a variable number of `.dar` step NODES for the
 * same "no loop node kind" reason above, but perfectly expressible as a
 * variable number of `context.step()` CALLS inside a real TypeScript handler
 * (a real handler is not constrained to the fixed node-graph the visual
 * `.dar` model requires).
 *
 * Fallback prompts (used when `input.prompts` is missing, via the
 * `input.prompts ?? [...]` pattern - see `taskTimer.dar.template.ts`'s
 * `input.topic ?? "..."` / `input.message ?? "..."` convention) are the
 * ASL's own `Outputs.ExecutionInput` sample verbatim: "Name a random
 * city...", "Write two to three sentences describing the city mentioned
 * above", "Write a few sentences about the local cuisine of the city".
 *
 * Response decoding: `InvokeModelCommand`'s response `body` is a
 * `Uint8Array`, not already-parsed JSON - it must be decoded
 * (`new TextDecoder().decode(response.body)`) and `JSON.parse`d to reach
 * `{ output: { message: { content: [{ text: "..." }] } } }`, matching the
 * ASL Task's own `$states.result.Body.output.message.content[0].text`
 * reference exactly (Step Functions' Bedrock optimized integration
 * auto-parses `Body` for the ASL; the raw AWS SDK does not, so this
 * decode/parse step is this translation's explicit equivalent).
 *
 * Final return value matches the ASL's `Success` state's `Output` exactly:
 * `$join($conversation_history[[1..$count($conversation_history)]], '.')` -
 * i.e. every response EXCLUDING the seed empty-string entry, joined by a
 * literal `.` - translated directly as
 * `conversationHistory.slice(1).join(".")`.
 *
 * No branching, no waits, no callbacks - the single `step` node is both the
 * workflow's only real work and its terminal node (`"terminal": true`, no
 * outgoing edge).
 *
 * Structure (collapses the ASL's 4-state sequential loop into 1 `.dar`
 * node):
 *   start -> Chain_Prompts (step, terminal: true: reads `input.prompts`
 *            (falling back to the ASL sample's 3-prompt array), loops over
 *            them with a plain JS `for` loop, calling
 *            `@aws-sdk/client-bedrock-runtime`'s `BedrockRuntimeClient` /
 *            `InvokeModelCommand` against `amazon.nova-lite-v1:0` once per
 *            prompt, building `conversationHistory` sequentially, returning
 *            all responses joined by `.`)
 *
 * `dependencyMode: "linear"` (a single node after `start`, no branching).
 *
 * Placeholders (`{{...}}`) are filled in by
 * {@link resolveBedrockPromptChainingDar}. Unlike every prior pack with
 * infra, this pack needs NO CFN stack outputs - `{{REGION}}` is the only
 * placeholder, sourced directly from the caller's deploy target region (the
 * same "no CFN stack, region-only context" shape as
 * `nestedWorkflowChild.dar.template.ts`'s `NestedWorkflowChildDarContext`).
 */

const DAR_TEMPLATE = `{
  "darVersion": "1.0",
  "name": "BedrockPromptChaining",
  "dependencyMode": "linear",
  "nodes": [
    {
      "id": "start",
      "kind": "start",
      "name": "Start",
      "position": { "x": 40, "y": 0 }
    },
    {
      "id": "Chain_Prompts",
      "name": "Chain Prompts",
      "position": { "x": 40, "y": 150 },
      "kind": "step",
      "code": "const { BedrockRuntimeClient, InvokeModelCommand } = require(\\"@aws-sdk/client-bedrock-runtime\\");\\n\\nconst prompts = input.prompts ?? [\\n  \\"Name a random city. You must provide only one non-fictitious city. You must only provide the city's name, followed by a comma and the city's country of origin.\\",\\n  \\"Write two to three sentences describing the city mentioned above\\",\\n  \\"Write a few sentences about the local cuisine of the city\\",\\n];\\n\\nconst bedrockClient = new BedrockRuntimeClient({ region: \\"{{REGION}}\\" });\\n\\nconst conversationHistory = [\\"\\"];\\n\\nfor (let i = 0; i < prompts.length; i++) {\\n  const previousResponse = conversationHistory[conversationHistory.length - 1];\\n\\n  const response = await bedrockClient.send(\\n    new InvokeModelCommand({\\n      modelId: \\"amazon.nova-lite-v1:0\\",\\n      body: JSON.stringify({\\n        messages: [\\n          {\\n            role: \\"user\\",\\n            content: [{ text: previousResponse + \\".\\" + prompts[i] }],\\n          },\\n        ],\\n        inferenceConfig: { maxTokens: 250 },\\n      }),\\n      contentType: \\"application/json\\",\\n      accept: \\"application/json\\",\\n    }),\\n  );\\n\\n  const decoded = new TextDecoder().decode(response.body);\\n  const parsed = JSON.parse(decoded);\\n  const text = parsed.output.message.content[0].text;\\n\\n  conversationHistory.push(text);\\n}\\n\\nreturn conversationHistory.slice(1).join(\\".\\");",
      "terminal": true
    }
  ],
  "edges": [
    { "id": "e0_start_Chain_Prompts", "source": "start", "target": "Chain_Prompts" }
  ]
}`;

export interface BedrockPromptChainingDarContext {
  region: string;
}

/**
 * Fills in the .dar template's placeholders. Like
 * `nestedWorkflowChild.dar.template.ts`, this pack needs no CFN stack
 * outputs - `{{REGION}}` is the only placeholder, sourced from the caller's
 * deploy target region, not from any deployed infra (there is none - see
 * the header above for why there's no `bedrockPromptChaining.cfn.yaml.ts`).
 */
export function resolveBedrockPromptChainingDar(
  ctx: BedrockPromptChainingDarContext,
): string {
  return DAR_TEMPLATE.replace(/\{\{REGION\}\}/g, ctx.region);
}

export default DAR_TEMPLATE;
