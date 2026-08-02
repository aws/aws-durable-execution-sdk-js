/**
 * ASL definition for the "DynamicParallelProcessing" Step Functions starter
 * pack: reads a batch of messages from an SQS queue, then iterates over them
 * with a Map state, writing each to DynamoDB, deleting it from the queue,
 * and publishing a notification to SNS.
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/templates/DynamicParallelProcessing.yaml.ts`, mainline, fetched
 * 2026-07-23. Vendored verbatim as a one-time snapshot (the `DefinitionString`
 * ASL embedded in that template, with its `${DDBTable}`/`${SNSTopic}`/
 * `${SQSQueueURL}` `Fn::Sub` placeholders substituted back to the original
 * sample's literal `${DDBTable}`/`${SNSTopic}`/`${SQSQueueURL}` ASL intrinsic
 * placeholders - i.e. left as the plain ASL document's own
 * `${AWS::Partition}`-style substitutions, matching the other starter packs'
 * `.asl.json.ts` convention of vendoring the plain ASL document rather than
 * its CFN-embedded form).
 */
const content = `{
  "Comment": "An example of the Amazon States Language for reading messages from an SQS queue and iteratively processing each message.",
  "StartAt": "Read messages from SQS queue",
  "QueryLanguage": "JSONata",
  "States": {
    "Read messages from SQS queue": {
      "Type": "Task",
      "Resource": "arn:\${AWS::Partition}:states:::aws-sdk:sqs:receiveMessage",
      "Next": "Are there messages to process?",
      "Arguments": { "QueueUrl": "\${SQSQueueURL}", "AttributeNames": ["All"], "MaxNumberOfMessages": 10, "VisibilityTimeout": 30, "WaitTimeSeconds": 20 }
    },
    "Are there messages to process?": {
      "Type": "Choice",
      "Default": "Finish",
      "Choices": [{ "Next": "Process Messages", "Condition": "{% $exists($states.input.Messages) %}" }]
    },
    "Process Messages": {
      "Type": "Map",
      "Next": "Finish",
      "ItemProcessor": {
        "StartAt": "Write message to DynamoDB",
        "ProcessorConfig": { "Mode": "INLINE" },
        "States": {
          "Write message to DynamoDB": {
            "Type": "Task",
            "Resource": "arn:\${AWS::Partition}:states:::dynamodb:putItem",
            "Next": "Remove message from SQS queue",
            "Arguments": { "TableName": "\${DDBTable}", "ReturnConsumedCapacity": "TOTAL", "Item": { "MessageId": {"S": "{% $states.input.MessageDetails.MessageId %}"}, "Body": {"S": "{% $states.input.MessageDetails.Body %}"} } },
            "Output": "{% $states.input %}"
          },
          "Remove message from SQS queue": {
            "Type": "Task",
            "Resource": "arn:\${AWS::Partition}:states:::aws-sdk:sqs:deleteMessage",
            "Next": "Publish message to SNS topic",
            "Arguments": { "QueueUrl": "\${SQSQueueURL}", "ReceiptHandle": "{% $states.input.MessageDetails.ReceiptHandle %}" },
            "Output": "{% $states.input %}"
          },
          "Publish message to SNS topic": {
            "Type": "Task",
            "Resource": "arn:\${AWS::Partition}:states:::sns:publish",
            "End": true,
            "Arguments": { "Subject": "Message from Step Functions!", "Message": "{% $states.input.MessageDetails.Body %}", "TopicArn": "\${SNSTopic}" }
          }
        }
      },
      "ItemSelector": { "MessageNumber": "{% $states.context.Map.Item.Index %}", "MessageDetails": "{% $states.context.Map.Item.Value %}" },
      "Items": "{% $states.input.Messages %}"
    },
    "Finish": { "Type": "Succeed" }
  }
}`;

export default content;
