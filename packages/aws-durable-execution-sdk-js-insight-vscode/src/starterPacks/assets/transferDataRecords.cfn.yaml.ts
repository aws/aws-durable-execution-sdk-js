/**
 * CloudFormation template for the "TransferDataRecords" Step Functions
 * starter pack, STRIPPED of its original Step-Functions-specific
 * orchestration.
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/templates/TransferDataRecords.yaml.ts`, mainline, fetched
 * 2026-07-23. Vendored as a one-time snapshot.
 *
 * Changes from the original template:
 *  1. Removed \`DynamoDBToSQSStateMachine\` (\`AWS::StepFunctions::StateMachine\`,
 *     the ASL-embedding resource) and \`DynamoDBToSQSExecutionRole\` (its
 *     now-orphaned execution role, whose only Policy - \`lambda:InvokeFunction\`
 *     on the seeding function, \`dynamodb:GetItem\` on the table,
 *     \`sqs:SendMessage\` on the queue - has no remaining consumer once the
 *     state machine is gone) - we deploy the workflow as a durable Lambda
 *     instead (see \`transferDataRecords.dar.template.ts\`), which needs its
 *     own IAM permissions (auto-inferred + attached by the existing
 *     \`deployWorkflow()\` in \`../deploy.ts\`, not this template).
 *  2. Kept \`DDBTable\` (\`AWS::DynamoDB::Table\`, unchanged - single hash key
 *     \`MessageId\` (S), PROVISIONED throughput 10/10), \`SQSQueue\`
 *     (\`AWS::SQS::Queue\`, unchanged - no special config), and
 *     \`SeedingFunction\` + \`SeedingFunctionExecutionRole\` (unchanged - this
 *     Lambda is the workflow's own first real step, invoked directly by the
 *     durable Lambda's \`Seed_The_Dynamo_Db_Table\` step via
 *     \`@aws-sdk/client-lambda\`'s \`InvokeCommand\`, matching the ASL's own
 *     "Seed the DynamoDB Table" state - it is NOT a deploy-time custom
 *     resource, so it is kept exactly as the source template defines it).
 *
 *     **PROVISIONED vs. PAY_PER_REQUEST decision**: kept PROVISIONED (10
 *     read / 10 write capacity units), matching the source template
 *     verbatim, rather than switching to PAY_PER_REQUEST. This mirrors
 *     \`dynamicParallelProcessing.cfn.yaml.ts\`'s own \`DDBTable\` - that pack's
 *     table also kept its source template's PROVISIONED throughput (1/1)
 *     rather than switching billing modes - establishing PROVISIONED as
 *     this codebase's convention for vendored DynamoDB tables (faithful
 *     reproduction of the source infra, not a silent billing-mode
 *     migration). For a 10-record POC workload, 10/10 capacity units is
 *     already generously over-provisioned (the workflow's own loop issues
 *     at most one \`GetItem\` at a time, sequentially, with no concurrent
 *     load), so there is no throttling risk either way - the choice here is
 *     about template fidelity, not performance.
 *  3. \`Outputs\` replaced: \`StateMachineArn\`/\`ExecutionInput\` (meaningless
 *     without the state machine) -> \`DDBTableName\` (\`Transfer_Records\`'s
 *     \`GetItemCommand\` needs the table name), \`SQSQueueUrl\`
 *     (\`Transfer_Records\`'s \`SendMessageCommand\` needs the queue's URL, not
 *     its ARN - SQS SDK calls are all URL-addressed), and
 *     \`SeedingFunctionArn\` (\`Seed_The_Dynamo_Db_Table\`'s \`InvokeCommand\`
 *     needs the seeding Lambda's ARN).
 */
const content = `---
AWSTemplateFormatVersion: "2010-09-09"
Description: >-
  Workflow Studio "TransferDataRecords" starter pack infra (stripped of the
  original Step Functions state machine - see
  transferDataRecords.cfn.yaml.ts's header comment for what changed and why,
  INCLUDING the PROVISIONED-vs-PAY_PER_REQUEST decision for DDBTable).
Resources:
  DDBTable:
    Type: AWS::DynamoDB::Table
    Properties:
      ProvisionedThroughput:
        ReadCapacityUnits: "10"
        WriteCapacityUnits: "10"
      AttributeDefinitions:
        - AttributeName: "MessageId"
          AttributeType: "S"
      KeySchema:
        - AttributeName: "MessageId"
          KeyType: "HASH"
  SQSQueue:
    Type: AWS::SQS::Queue
  SeedingFunctionExecutionRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: "sts:AssumeRole"
      Policies:
        - PolicyName: DynamoDBSeedingPolicy
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: Allow
                Action:
                  - "dynamodb:PutItem"
                Resource: !GetAtt [ DDBTable, Arn ]
        - PolicyName: CloudWatchLogsPolicy
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: Allow
                Action:
                  - "logs:CreateLogGroup"
                  - "logs:CreateLogStream"
                  - "logs:PutLogEvents"
                Resource: !Sub "arn:\${AWS::Partition}:logs:*:*:*"
  SeedingFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: index.handler
      Role: !GetAtt [ SeedingFunctionExecutionRole, Arn ]
      Runtime: nodejs22.x
      Timeout: 25
      Code:
        ZipFile: |
          const { DynamoDBClient, PutItemCommand } = require("@aws-sdk/client-dynamodb");

          const ddbClient = new DynamoDBClient();

          /**
          * Seeds the DynamoDB table with 10 sample messages
          * (MessageNo0..MessageNo9), then returns the ordered list of message
          * ids terminated by a "DONE" sentinel - matching the ASL's own "Seed
          * the DynamoDB Table" Task, whose result is assigned directly to the
          * for-loop's list variable.
          *
          * @param {Object} event - Input event to the Lambda function
          * @param {Object} context - Lambda Context runtime methods and attributes
          *
          * @returns {string[]} - Ordered message ids, e.g.
          *   ["MessageNo0", ..., "MessageNo9", "DONE"]
          */
          exports.handler = async (event, context) => {
              const messageIds = [];

              for (let i = 0; i < 10; i++) {
                  const messageId = "MessageNo" + i;
                  await ddbClient.send(
                      new PutItemCommand({
                          TableName: process.env.DDB_TABLE_NAME,
                          Item: {
                              MessageId: { S: messageId },
                              Message: { S: "Hi! This is message no " + i },
                          },
                      }),
                  );
                  messageIds.push(messageId);
              }

              messageIds.push("DONE");
              return messageIds;
          };
      Environment:
        Variables:
          DDB_TABLE_NAME: !Ref DDBTable
Outputs:
  DDBTableName:
    Value: !Ref DDBTable
  SQSQueueUrl:
    Value: !Ref SQSQueue
  SeedingFunctionArn:
    Value: !GetAtt [ SeedingFunction, Arn ]
`;

export default content;
