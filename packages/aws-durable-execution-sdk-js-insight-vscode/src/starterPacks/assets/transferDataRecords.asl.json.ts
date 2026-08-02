/**
 * ASL definition for the "TransferDataRecords" Step Functions starter pack:
 * seeds a DynamoDB table with sample messages, then loops over their ids,
 * reading each message from DynamoDB and forwarding its body to an SQS
 * queue, until a `"DONE"` sentinel is reached.
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/templates/TransferDataRecords.yaml.ts`, mainline, fetched
 * 2026-07-23. Vendored verbatim as a one-time snapshot (the `DefinitionString`
 * ASL embedded in that template's `DynamoDBToSQSStateMachine` resource,
 * matching the other starter packs' `.asl.json.ts` convention of vendoring
 * the plain ASL document rather than its CFN-embedded form).
 *
 * See `transferDataRecords.dar.template.ts`'s header for why this ASL's
 * `Seed the DynamoDB Table` -> `For Loop Condition` -> `Read Next Message
 * from DynamoDB` -> `Send Message to SQS` -> (loop back to `For Loop
 * Condition`) -> `Succeed` cycle - a variable-length sequential loop that
 * runs until `$List[0] == 'DONE'` - collapses to two `.dar` `step` nodes
 * (one for the one-time seeding Task, one containing a plain JS loop for the
 * rest), rather than a multi-node `.dar` structure.
 */
const content = `{
  "Comment": "An example of the Amazon States Language for reading messages from a DynamoDB table and sending them to SQS",
  "StartAt": "Seed the DynamoDB Table",
  "TimeoutSeconds": 3600,
  "QueryLanguage": "JSONata",
  "States": {
    "Seed the DynamoDB Table": {
      "Type": "Task",
      "Resource": "arn:\${AWS::Partition}:states:::lambda:invoke",
      "Arguments": { "FunctionName": "\${seedingFunctionArn}" },
      "Assign": { "List": "{% $states.result.Payload %}" },
      "Next": "For Loop Condition"
    },
    "For Loop Condition": {
      "Type": "Choice",
      "Choices": [{ "Next": "Read Next Message from DynamoDB", "Condition": "{% $List[0] != 'DONE' %}" }],
      "Default": "Succeed"
    },
    "Read Next Message from DynamoDB": {
      "Type": "Task",
      "Resource": "arn:\${AWS::Partition}:states:::dynamodb:getItem",
      "Arguments": { "TableName": "\${ddbTableName}", "Key": { "MessageId": {"S": "{% $List[0] %}"} } },
      "Next": "Send Message to SQS"
    },
    "Send Message to SQS": {
      "Type": "Task",
      "Resource": "arn:\${AWS::Partition}:states:::sqs:sendMessage",
      "Arguments": { "MessageBody": "{% $states.input.Item.Message.S%}", "QueueUrl": "\${sqsQueueUrl}" },
      "Assign": { "List": "{% $List[[1..$count($List)]] %}" },
      "Next": "For Loop Condition"
    },
    "Succeed": { "Type": "Succeed" }
  }
}`;

export default content;
