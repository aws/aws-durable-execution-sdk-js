/**
 * `.dar` workflow for the "DynamicParallelProcessing" Step Functions starter
 * pack. Hand-authored (not machine-imported) following the same convention as
 * `taskTimer.dar.template.ts` / `waitForCallback.dar.template.ts` /
 * `jobStatusPoller.dar.template.ts` - see `helloLambda.dar.template.ts`'s
 * header for the general "why hand-author, not import" rationale.
 *
 * New structural pattern this pack exercises (none of the prior packs used
 * it): ASL's `Map` state -> a `.dar` `map` node. Its `itemsCode` returns the
 * array to iterate; its `body` is a NESTED, self-contained `.dar` sub-workflow
 * (own `start`/nodes/edges) executed once per item, with `item`/`index` in
 * scope as plain identifiers inside that nested body's node `code` (confirmed
 * against `generateHandler.ts`'s `map` codegen:
 * `await ctx.map(name, items, async (ctx, item, index) => { ... })` - the
 * nested body's own `ctx` is a NEW child context, distinct from the outer
 * `context`). The map body's exit node is a plain operation node (a `step`
 * here) marked `"terminal": true`, NOT an `"end"`-kind node - confirmed
 * against `generateHandler.test.ts`'s own map fixture, which uses exactly
 * that shape for a nested body's last node.
 *
 * REAL BUG FOUND during this pack's actual AWS verification (fixed here, the
 * canonical lesson for every future pack using `map`): a `map` node's bound
 * result is NOT a plain array of item results - it's a `BatchResult` object
 * (`{ all: [{result, index, status}, ...], completionReason }`, plus methods/
 * getters like `.successCount`/`.failureCount`/`.totalCount`/`.getResults()`
 * - see `packages/aws-durable-execution-sdk-js/src/handlers/
 * concurrent-execution-handler/batch-result.ts`). `Finish_Processed` originally
 * read `Process_Messages.length` (assuming a plain array) - `.length` is
 * `undefined` on a `BatchResult`, so `{ processedCount: undefined }` silently
 * serialized to `{}` (JSON.stringify drops `undefined`-valued keys) on real
 * execution, even though `validateDarJson`'s dry-run passed and every actual
 * side effect (DynamoDB write, SQS delete, SNS publish) executed correctly -
 * this bug was invisible until a real end-to-end AWS run inspected the
 * workflow's actual returned `Result`. Fixed to `Process_Messages.successCount`.
 *
 * ASL's `Choice` ("Are there messages to process?") -> a `condition` node,
 * same pattern as JobStatusPoller's `Job_Complete` node: `code` returns a
 * matchable string, and outgoing edges carry `"match"` (or omit it for the
 * default branch). Requires `"dependencyMode": "dag"` for the same reason as
 * JobStatusPoller (the condition node fans out to two different targets).
 *
 * ASL's `Succeed` ("Finish") state is reached from BOTH the Choice's default
 * branch (no messages) and the Map's `Next` (messages processed) - the ASL
 * itself converges both paths to one state. This template keeps them as two
 * separate `.dar` `end` nodes (`Finish_Empty` / `Finish_Processed`) rather
 * than one shared node, since a `.dar` node can only have one set of incoming
 * edges represented as a simple chain per `emitChain`'s traversal, and DAG
 * mode's condition-branch tails are simplest when each branch ends in its own
 * terminal - but BOTH nodes return the SAME shape, `{ processedCount: N }`,
 * so the workflow's overall return value is well-typed and consistent
 * regardless of which branch was taken (0 when there were no messages to
 * read; the number of messages actually processed by the map otherwise) -
 * deliberately not just "whatever the last node's raw result happened to be"
 * (the ASL's own `Succeed` state carries no payload shape at all, so this is
 * a durable-Lambda-specific improvement, not a fidelity requirement).
 *
 * ASL's `ItemSelector` (`{ MessageNumber: <index>, MessageDetails: <rawMsg> }`)
 * is replicated inside the map node's `itemsCode` itself, so the nested body's
 * `item` already has `.MessageDetails.MessageId` / `.MessageDetails.Body` /
 * `.MessageDetails.ReceiptHandle` directly, matching the ASL's own nested
 * `$states.input.MessageDetails.*` field references faithfully.
 *
 * No Lambda invokes anywhere in this pack (unlike HelloLambda/JobStatusPoller/
 * WaitForCallback) - every step talks directly to SQS/DynamoDB/SNS via
 * `@aws-sdk/client-sqs` / `@aws-sdk/client-dynamodb` / `@aws-sdk/client-sns`
 * v3 calls, so `generateHandler.ts`'s `fixLambdaPayloadDecoding` rewrite
 * (for `JSON.parse(X.Payload)`) never applies here.
 *
 * Every embedded code string below uses string concatenation (`"a" + b +
 * "c"`) instead of template literals for anything that needs to reference a
 * value at generated-handler runtime, so this outer `.dar.template.ts`
 * template literal never has to escape a nested `${...}` - the established
 * lesson from HelloLambda's real verification run (nested template-literal
 * escaping is a reliable source of subtle corruption).
 *
 * Structure (mirrors the ASL's states, collapsed to `.dar` nodes):
 *   start -> Read_Messages (step: ReceiveMessageCommand against
 *            {{SQS_QUEUE_URL}}, MaxNumberOfMessages 10, VisibilityTimeout 30,
 *            WaitTimeSeconds 20, AttributeNames ["All"] - matches the ASL's
 *            Arguments faithfully; returns the raw ReceiveMessageCommand
 *            response)
 *         -> Are_There_Messages (condition: checks Read_Messages.Messages
 *            exists and is non-empty - the ASL Choice state's direct
 *            equivalent)
 *              match "HAS_MESSAGES" -> Process_Messages (map: itemsCode maps
 *                 Read_Messages.Messages into the ASL's ItemSelector shape;
 *                 nested body: start -> Write_To_DynamoDB (step: PutItemCommand)
 *                 -> Remove_From_SQS (step: DeleteMessageCommand)
 *                 -> Publish_To_SNS (step, terminal: true: PublishCommand))
 *                 -> Finish_Processed (end: returns
 *                 { processedCount: Process_Messages.successCount })
 *              default            -> Finish_Empty (end: returns
 *                 { processedCount: 0 })
 *
 * Placeholders (`{{...}}`) are filled in by
 * {@link resolveDynamicParallelProcessingDar} from a deployed CFN stack's
 * outputs (see `../cfnDeploy.ts` / `dynamicParallelProcessing.cfn.yaml.ts`).
 */

const DAR_TEMPLATE = `{
  "darVersion": "1.0",
  "name": "DynamicParallelProcessing",
  "dependencyMode": "dag",
  "nodes": [
    {
      "id": "start",
      "kind": "start",
      "name": "Start",
      "position": { "x": 40, "y": 0 }
    },
    {
      "id": "Read_Messages",
      "name": "Read Messages",
      "position": { "x": 40, "y": 150 },
      "kind": "step",
      "code": "const { SQSClient, ReceiveMessageCommand } = require(\\"@aws-sdk/client-sqs\\");\\n\\nconst sqsClient = new SQSClient({ region: \\"{{REGION}}\\" });\\n\\nconst response = await sqsClient.send(\\n  new ReceiveMessageCommand({\\n    QueueUrl: \\"{{SQS_QUEUE_URL}}\\",\\n    AttributeNames: [\\"All\\"],\\n    MaxNumberOfMessages: 10,\\n    VisibilityTimeout: 30,\\n    WaitTimeSeconds: 20,\\n  }),\\n);\\n\\nreturn { Messages: response.Messages ?? [] };"
    },
    {
      "id": "Are_There_Messages",
      "name": "Are There Messages?",
      "position": { "x": 40, "y": 300 },
      "kind": "condition",
      "code": "return (Read_Messages.Messages && Read_Messages.Messages.length > 0) ? \\"HAS_MESSAGES\\" : \\"EMPTY\\";"
    },
    {
      "id": "Process_Messages",
      "name": "Process Messages",
      "position": { "x": 40, "y": 450 },
      "kind": "map",
      "itemsCode": "return (Read_Messages.Messages ?? []).map((message, i) => ({\\n  MessageNumber: i,\\n  MessageDetails: message,\\n}));",
      "body": {
        "darVersion": "1.0",
        "name": "Process_Messages_Body",
        "dependencyMode": "linear",
        "nodes": [
          {
            "id": "body_start",
            "kind": "start",
            "name": "Start",
            "position": { "x": 40, "y": 0 }
          },
          {
            "id": "Write_To_DynamoDB",
            "name": "Write To DynamoDB",
            "position": { "x": 40, "y": 150 },
            "kind": "step",
            "code": "const { DynamoDBClient, PutItemCommand } = require(\\"@aws-sdk/client-dynamodb\\");\\n\\nconst ddbClient = new DynamoDBClient({ region: \\"{{REGION}}\\" });\\n\\nawait ddbClient.send(\\n  new PutItemCommand({\\n    TableName: \\"{{DDB_TABLE_NAME}}\\",\\n    Item: {\\n      MessageId: { S: item.MessageDetails.MessageId },\\n      Body: { S: item.MessageDetails.Body },\\n    },\\n  }),\\n);\\n\\nreturn item;"
          },
          {
            "id": "Remove_From_SQS",
            "name": "Remove From SQS",
            "position": { "x": 40, "y": 300 },
            "kind": "step",
            "code": "const { SQSClient, DeleteMessageCommand } = require(\\"@aws-sdk/client-sqs\\");\\n\\nconst sqsClient = new SQSClient({ region: \\"{{REGION}}\\" });\\n\\nawait sqsClient.send(\\n  new DeleteMessageCommand({\\n    QueueUrl: \\"{{SQS_QUEUE_URL}}\\",\\n    ReceiptHandle: item.MessageDetails.ReceiptHandle,\\n  }),\\n);\\n\\nreturn item;"
          },
          {
            "id": "Publish_To_SNS",
            "name": "Publish To SNS",
            "position": { "x": 40, "y": 450 },
            "kind": "step",
            "code": "const { SNSClient, PublishCommand } = require(\\"@aws-sdk/client-sns\\");\\n\\nconst snsClient = new SNSClient({ region: \\"{{REGION}}\\" });\\n\\nconst response = await snsClient.send(\\n  new PublishCommand({\\n    Subject: \\"Message from Step Functions!\\",\\n    Message: item.MessageDetails.Body,\\n    TopicArn: \\"{{SNS_TOPIC_ARN}}\\",\\n  }),\\n);\\n\\nreturn { MessageId: response.MessageId };",
            "terminal": true
          }
        ],
        "edges": [
          { "id": "be0_body_start_Write_To_DynamoDB", "source": "body_start", "target": "Write_To_DynamoDB" },
          { "id": "be1_Write_To_DynamoDB_Remove_From_SQS", "source": "Write_To_DynamoDB", "target": "Remove_From_SQS" },
          { "id": "be2_Remove_From_SQS_Publish_To_SNS", "source": "Remove_From_SQS", "target": "Publish_To_SNS" }
        ]
      }
    },
    {
      "id": "Finish_Processed",
      "name": "Finish (Processed)",
      "position": { "x": 40, "y": 600 },
      "kind": "end",
      "code": "return { processedCount: Process_Messages.successCount };"
    },
    {
      "id": "Finish_Empty",
      "name": "Finish (Empty)",
      "position": { "x": 300, "y": 450 },
      "kind": "end",
      "code": "return { processedCount: 0 };"
    }
  ],
  "edges": [
    { "id": "e0_start_Read_Messages", "source": "start", "target": "Read_Messages" },
    { "id": "e1_Read_Messages_Are_There_Messages", "source": "Read_Messages", "target": "Are_There_Messages" },
    { "id": "e2_Are_There_Messages_Process_Messages", "source": "Are_There_Messages", "target": "Process_Messages", "match": "HAS_MESSAGES" },
    { "id": "e3_Are_There_Messages_Finish_Empty", "source": "Are_There_Messages", "target": "Finish_Empty" },
    { "id": "e4_Process_Messages_Finish_Processed", "source": "Process_Messages", "target": "Finish_Processed" }
  ]
}`;

export interface DynamicParallelProcessingDarContext {
  region: string;
  sqsQueueUrl: string;
  ddbTableName: string;
  snsTopicArn: string;
}

/** Fills in the .dar template's placeholders from a deployed CFN stack's outputs. */
export function resolveDynamicParallelProcessingDar(
  ctx: DynamicParallelProcessingDarContext,
): string {
  return DAR_TEMPLATE.replace(/\{\{REGION\}\}/g, ctx.region)
    .replace(/\{\{SQS_QUEUE_URL\}\}/g, ctx.sqsQueueUrl)
    .replace(/\{\{DDB_TABLE_NAME\}\}/g, ctx.ddbTableName)
    .replace(/\{\{SNS_TOPIC_ARN\}\}/g, ctx.snsTopicArn);
}

export default DAR_TEMPLATE;
