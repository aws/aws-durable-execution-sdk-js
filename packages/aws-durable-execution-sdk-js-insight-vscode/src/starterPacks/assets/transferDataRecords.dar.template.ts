/**
 * `.dar` workflow for the "TransferDataRecords" Step Functions starter
 * pack. Hand-authored (not machine-imported) following the same convention
 * as `bedrockPromptChaining.dar.template.ts` (most similar prior pack - a
 * tight sequential loop with NO wait between iterations, collapsed into ONE
 * step node with a plain JS for loop) / `taskTimer.dar.template.ts` /
 * `waitForCallback.dar.template.ts` / `jobStatusPoller.dar.template.ts` /
 * `dynamicParallelProcessing.dar.template.ts` - see
 * `helloLambda.dar.template.ts`'s header for the general "why hand-author,
 * not import" rationale.
 *
 * STRUCTURAL TRANSLATION - the interesting part of this pack. The source
 * ASL (`transferDataRecords.asl.json.ts`) is: `Seed the DynamoDB Table`
 * (Task, invokes a seeding Lambda, assigns its result to `List`) ->
 * `For Loop Condition` (Choice, branches on `$List[0] != 'DONE'` back into
 * `Read Next Message from DynamoDB` (Task) or out to `Succeed`), and
 * `Read Next Message from DynamoDB` -> `Send Message to SQS` (Task, also
 * shifts `List` by one element) -> loops back to `For Loop Condition` - a
 * classic "Choice state pointing back upstream" ASL looping idiom, repeated
 * once per seeded message id (exactly 10 times, until the `"DONE"` sentinel
 * is reached).
 *
 * This is a TIGHT sequential loop with ZERO wait between iterations (unlike
 * `jobStatusPoller.dar.template.ts`/`athenaDataQuery.dar.template.ts`'s
 * polling loops, which DO wait between attempts and correctly use
 * `waitForCondition`). Exactly like `bedrockPromptChaining.dar.template.ts`'s
 * already-solved case: `waitForCondition` is designed for
 * polling-with-backoff semantics (wait between attempts) - forcing a
 * zero-wait tight loop through it would be a worse, less-faithful fit than
 * the alternative. The `.dar` model has NO loop/repeat/cycle node kind at
 * all - `DAR_NODE_KINDS` in
 * `@aws/durable-execution-sdk-js-visual-workflow-model`'s `kinds.ts` is a
 * closed set: `start, step, inline, wait, callback, chainInvoke,
 * waitForCondition, condition, map, group, parallel, awsJob, awsSdkCall,
 * end`. A cycle in the `.dar` graph does not compile to a runtime loop (see
 * `bedrockPromptChaining.dar.template.ts`'s header for the full
 * `emitChain`/`visited`-set reasoning, which applies identically here) -
 * there is no way to express "repeat this subgraph until a runtime sentinel
 * is seen" via `.dar` node/edge structure.
 *
 * CONCLUSION: the only faithful, correct translation is ONE `step` node
 * ("Transfer_Records") whose `code` contains a plain JavaScript loop,
 * calling `@aws-sdk/client-dynamodb`'s `GetItemCommand` and
 * `@aws-sdk/client-sqs`'s `SendMessageCommand` sequentially inside that
 * single step for each seeded message id - exactly the "PLAIN JAVASCRIPT
 * loop inside one step" pattern AGENTS.md's own "GenAI Agent (Agentic
 * Loop)" example documents, and `bedrockPromptChaining.dar.template.ts`'s
 * identical precedent for this SDK.
 *
 * The SEEDING step ("Seed_The_Dynamo_Db_Table") is a SEPARATE, PRECEDING
 * `step` node, NOT folded into `Transfer_Records`'s loop - matching the
 * ASL's OWN separate state boundary (seeding happens once via its own Task,
 * THEN the loop begins) and the established "start-once vs. loop-body"
 * pattern from `jobStatusPoller.dar.template.ts`'s "Submit_Job" /
 * "Poll_Job_Status" split (submission must happen exactly once; folding it
 * into a repeatedly-invoked body would resubmit/reseed on every iteration -
 * not applicable here since there's no repeated body invocation at the
 * `.dar` level, but the same "one-time setup gets its own node" principle
 * applies for clarity and fidelity to the ASL's own state boundaries).
 *
 * DONE-sentinel loop termination: `Seed_The_Dynamo_Db_Table` returns
 * `["MessageNo0", ..., "MessageNo9", "DONE"]` (the seeding Lambda's own
 * literal output - see `transferDataRecords.cfn.yaml.ts`'s
 * `SeedingFunction`). `Transfer_Records`'s loop walks that array with a
 * plain `for...of`, `break`-ing the instant it sees the literal string
 * `"DONE"` - the direct translation of the ASL's own `$List[0] != 'DONE'`
 * Choice condition (process entries, in order, until `DONE` is reached;
 * `DONE` itself is never processed as a message id).
 *
 * KNOWN BEHAVIORAL DIFFERENCE FROM THE SOURCE ASL, worth stating plainly
 * rather than papering over (the SAME trade-off
 * `bedrockPromptChaining.dar.template.ts`'s header already documents for
 * its own collapsed loop): in the ASL, each `Read Next Message from
 * DynamoDB` / `Send Message to SQS` pair is its own checkpoint - a redrive
 * after a mid-loop failure resumes at `For Loop Condition` with `List`
 * already shifted past every message already transferred, and only
 * re-transfers the remainder. In this `.dar` translation, the entire loop
 * is ONE step, hence ONE checkpoint: if the durable function crashes or is
 * retried partway through the loop, the WHOLE loop restarts from scratch on
 * replay, and EVERY record already transferred gets read from DynamoDB and
 * re-sent to SQS again - not just the remaining ones. This means duplicate
 * SQS messages on any mid-loop retry, unlike the ASL's per-Task granularity.
 * Acceptable for a 10-record POC (a handful of cheap DynamoDB reads / SQS
 * sends) but a real production translation of a much larger transfer
 * should likely give each record's read+send its OWN named
 * `context.step()` call (in a real handler, not a `.dar` node) for
 * per-record checkpointing - not possible to express as a variable number
 * of `.dar` step NODES for the same "no loop node kind" reason above, but
 * perfectly expressible as a variable number of `context.step()` CALLS
 * inside a real TypeScript handler.
 *
 * Return value shape: the ASL's own `Succeed` state carries no payload at
 * all (a bare `{ "Type": "Succeed" }`), so there is no ASL shape to match
 * faithfully. This translation returns
 * `{ transferredCount: N, transferredMessageIds: [...] }` - the count for
 * an at-a-glance result, and the ordered list of ids for anyone inspecting
 * exactly what was moved - a deliberate, durable-Lambda-specific
 * improvement over "no payload", following the same reasoning
 * `dynamicParallelProcessing.dar.template.ts`'s `Finish_Processed`/
 * `Finish_Empty` nodes already established (return a well-typed, useful
 * shape even where the source ASL's own terminal state carried none).
 *
 * Response decoding: `Seed_The_Dynamo_Db_Table` uses a plain
 * `JSON.parse(response.Payload)` - `generateHandler.ts`'s
 * `fixLambdaPayloadDecoding` rewrite rewrites that exact pattern to decode
 * the underlying `Uint8Array` via `TextDecoder` automatically (see
 * `jobStatusPoller.dar.template.ts`'s identical note), so this hand-written
 * code deliberately does NOT add its own `TextDecoder` call - doing so
 * would no longer match the rewrite's regex and would double-decode.
 *
 * REAL BUG FOUND during this pack's actual AWS verification (fixed here,
 * `validateDarJson`'s dry-run did NOT catch it - a genuinely new category of
 * bug for this session, worth understanding precisely for every future
 * pack): a node's generated-code IDENTIFIER (the `const` name other nodes
 * reference) is derived from `toIdentifier(node.NAME)` - the node's DISPLAY
 * `name` field - NEVER from its `id` field. Confirmed directly against
 * `@aws/durable-execution-sdk-js-visual-workflow-model`'s
 * `buildIdentifierMap`/`toIdentifier`: it simply replaces every
 * non-alphanumeric character in `name` with `_` (so `"Seed The DynamoDB
 * Table"` becomes `Seed_The_DynamoDB_Table` - note "DynamoDB"'s internal
 * capitalization survives UNCHANGED, since only the surrounding SPACES
 * become underscores, there is no camelCase/PascalCase-boundary splitting
 * at all). The first version of `Transfer_Records`'s code referenced
 * `Seed_The_Dynamo_Db_Table` (matching this NODE'S OWN `id` field, which
 * this pack's author had written with underscores inserted at every
 * word/case boundary, PascalCase-style) - a plausible-looking but WRONG
 * guess, since the real generated identifier (derived from `name`, not
 * `id`) is `Seed_The_DynamoDB_Table` (no split inside "DynamoDB"). Every
 * PRIOR pack's node `id`s happened to already look like reasonable
 * `toIdentifier(name)` output by coincidence, so this mismatch never
 * surfaced until this pack's `id`/`name` diverged specifically around an
 * acronym-like compound word. `validateDarJson`'s dry-run did not catch
 * this either - real execution failed immediately with "Seed_The_Dynamo_Db_Table
 * is not defined" (a plain ReferenceError) on the very first invocation.
 * LESSON for every future pack: always reference an upstream node by
 * `toIdentifier(<that node's exact NAME string>)`, computed by hand
 * (replace every non-alphanumeric character with `_`) - NEVER assume it
 * matches that node's own `id` field, even when they look similar.
 *
 * Every embedded code string below uses string concatenation (`"a" + b +
 * "c"`) instead of template literals for anything that needs to reference a
 * value at generated-handler runtime, so this outer `.dar.template.ts`
 * template literal never has to escape a nested `${...}` - the established
 * lesson from HelloLambda's real verification run (nested template-literal
 * escaping is a reliable source of subtle corruption).
 *
 * Structure (collapses the ASL's 5-state sequential loop into 2 `.dar`
 * nodes):
 *   start -> Seed_The_Dynamo_Db_Table (step: invokes
 *            `{{SEEDING_FUNCTION_ARN}}` via `@aws-sdk/client-lambda`'s
 *            `InvokeCommand`, returns the parsed JSON-array response
 *            payload - e.g. ["MessageNo0", ..., "MessageNo9", "DONE"])
 *         -> Transfer_Records (step, terminal: true: reads
 *            `Seed_The_Dynamo_Db_Table`'s array, loops over every entry
 *            until (and excluding) the "DONE" sentinel; for each: reads the
 *            message from `{{DDB_TABLE_NAME}}` via `GetItemCommand`, then
 *            forwards its body to `{{SQS_QUEUE_URL}}` via
 *            `SendMessageCommand`; returns
 *            `{ transferredCount, transferredMessageIds }`)
 *
 * `dependencyMode: "linear"` (no branching - the whole loop lives inside
 * one step's code, not expressed as `.dar` nodes/edges).
 *
 * Placeholders (`{{...}}`) are filled in by
 * {@link resolveTransferDataRecordsDar} from a deployed CFN stack's outputs
 * (see `../cfnDeploy.ts` / `transferDataRecords.cfn.yaml.ts`).
 */

const DAR_TEMPLATE = `{
  "darVersion": "1.0",
  "name": "TransferDataRecords",
  "dependencyMode": "linear",
  "nodes": [
    {
      "id": "start",
      "kind": "start",
      "name": "Start",
      "position": { "x": 40, "y": 0 }
    },
    {
      "id": "Seed_The_Dynamo_Db_Table",
      "name": "Seed The DynamoDB Table",
      "position": { "x": 40, "y": 150 },
      "kind": "step",
      "code": "const { LambdaClient, InvokeCommand } = require(\\"@aws-sdk/client-lambda\\");\\n\\nconst lambdaClient = new LambdaClient({ region: \\"{{REGION}}\\" });\\n\\nconst response = await lambdaClient.send(\\n  new InvokeCommand({\\n    FunctionName: \\"{{SEEDING_FUNCTION_ARN}}\\",\\n  }),\\n);\\n\\nreturn JSON.parse(response.Payload);"
    },
    {
      "id": "Transfer_Records",
      "name": "Transfer Records",
      "position": { "x": 40, "y": 300 },
      "kind": "step",
      "code": "const { DynamoDBClient, GetItemCommand } = require(\\"@aws-sdk/client-dynamodb\\");\\nconst { SQSClient, SendMessageCommand } = require(\\"@aws-sdk/client-sqs\\");\\n\\nconst ddbClient = new DynamoDBClient({ region: \\"{{REGION}}\\" });\\nconst sqsClient = new SQSClient({ region: \\"{{REGION}}\\" });\\n\\nconst transferredMessageIds = [];\\n\\nfor (const messageId of Seed_The_DynamoDB_Table) {\\n  if (messageId === \\"DONE\\") break;\\n\\n  const getItemResponse = await ddbClient.send(\\n    new GetItemCommand({\\n      TableName: \\"{{DDB_TABLE_NAME}}\\",\\n      Key: { MessageId: { S: messageId } },\\n    }),\\n  );\\n\\n  const messageBody = getItemResponse.Item.Message.S;\\n\\n  await sqsClient.send(\\n    new SendMessageCommand({\\n      MessageBody: messageBody,\\n      QueueUrl: \\"{{SQS_QUEUE_URL}}\\",\\n    }),\\n  );\\n\\n  transferredMessageIds.push(messageId);\\n}\\n\\nreturn {\\n  transferredCount: transferredMessageIds.length,\\n  transferredMessageIds,\\n};",
      "terminal": true
    }
  ],
  "edges": [
    { "id": "e0_start_Seed_The_Dynamo_Db_Table", "source": "start", "target": "Seed_The_Dynamo_Db_Table" },
    { "id": "e1_Seed_The_Dynamo_Db_Table_Transfer_Records", "source": "Seed_The_Dynamo_Db_Table", "target": "Transfer_Records" }
  ]
}`;

export interface TransferDataRecordsDarContext {
  region: string;
  seedingFunctionArn: string;
  ddbTableName: string;
  sqsQueueUrl: string;
}

/** Fills in the .dar template's placeholders from a deployed CFN stack's outputs. */
export function resolveTransferDataRecordsDar(
  ctx: TransferDataRecordsDarContext,
): string {
  return DAR_TEMPLATE.replace(/\{\{REGION\}\}/g, ctx.region)
    .replace(/\{\{SEEDING_FUNCTION_ARN\}\}/g, ctx.seedingFunctionArn)
    .replace(/\{\{DDB_TABLE_NAME\}\}/g, ctx.ddbTableName)
    .replace(/\{\{SQS_QUEUE_URL\}\}/g, ctx.sqsQueueUrl);
}

export default DAR_TEMPLATE;
