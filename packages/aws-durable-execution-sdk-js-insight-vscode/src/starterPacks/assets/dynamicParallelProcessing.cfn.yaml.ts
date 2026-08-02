/**
 * CloudFormation template for the "DynamicParallelProcessing" Step Functions
 * starter pack, STRIPPED of its original Step-Functions-specific
 * orchestration.
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/templates/DynamicParallelProcessing.yaml.ts`, mainline, fetched
 * 2026-07-23. Vendored as a one-time snapshot.
 *
 * Changes from the original template:
 *  1. Removed `MapStateStateMachine` (`AWS::StepFunctions::StateMachine`, the
 *     ASL-embedding resource) and `StatesExecutionRole` (its now-orphaned
 *     execution role, whose only Policy - `sqs:DeleteMessage`/
 *     `sqs:ReceiveMessage` on the queue, `dynamodb:PutItem` on the table,
 *     `sns:Publish` on the topic - has no remaining consumer once the state
 *     machine is gone) - we deploy the workflow as a durable Lambda instead
 *     (see `dynamicParallelProcessing.dar.template.ts`), which needs its own
 *     IAM permissions (auto-inferred + attached by the existing
 *     `deployWorkflow()` in `../deploy.ts`, not this template).
 *  2. Kept `DDBTable` (`AWS::DynamoDB::Table`, unchanged - single hash key
 *     `MessageId` (S), provisioned throughput 1/1), `SQSQueue`
 *     (`AWS::SQS::Queue`, unchanged - no special config), `SNSTopic`
 *     (`AWS::SNS::Topic`, unchanged - encrypted via
 *     `KmsMasterKeyId: !Ref SNSKeyAlias`), and `SNSKeyAlias`
 *     (`AWS::KMS::Alias`, unchanged including its `DependsOn: SNSKey` - still
 *     needed since the alias's `TargetKeyId` references the key) - none of
 *     these are Step-Functions-specific; the durable Lambda's own step code
 *     talks to them directly via `@aws-sdk/client-sqs`,
 *     `@aws-sdk/client-dynamodb`, and `@aws-sdk/client-sns`.
 *  3. **`SNSKey` (`AWS::KMS::Key`): removed the original's
 *     `DeletionPolicy: Retain` line - a DELIBERATE, EXPLICIT deviation from
 *     the source template's fidelity, not an oversight.** The original
 *     retains this key on stack deletion, presumably to protect against
 *     accidentally losing the key that encrypts a real/production topic's
 *     data (SNS message bodies encrypted under it would become
 *     unrecoverable if the key were deleted out from under live data). That
 *     protection is exactly backwards for our POC-and-fully-teardown
 *     verification methodology, established across every prior starter pack:
 *     these stacks are deployed, exercised once, and torn down completely,
 *     with zero tolerance for residue left behind after `delete-stack`. A
 *     retained KMS key is precisely such residue - it would silently survive
 *     every teardown, accumulate across repeated verification runs, and
 *     incur ongoing per-key charges for a resource nobody kept a reference
 *     to. Since this vendored asset only ever backs a throwaway POC
 *     deployment (never real production topic data), we remove `Retain` so
 *     the key deletes cleanly along with the rest of the stack.
 *  4. `Outputs` replaced: `StateMachineArn`/`ExecutionInput` (meaningless
 *     without the state machine) -> `SQSQueueUrl` (the imported `.dar`
 *     workflow's `Read_Messages`/`Remove_From_SQS` step code needs the
 *     queue's URL, not its ARN, for `ReceiveMessageCommand`/
 *     `DeleteMessageCommand`), `DDBTableName` (`Write_To_DynamoDB`'s
 *     `PutItemCommand` needs the table name), and `SNSTopicArn`
 *     (`Publish_To_SNS`'s `PublishCommand` needs the topic ARN). The queue's
 *     ARN is dropped - nothing in the `.dar` workflow needs it (SQS SDK calls
 *     are all URL-addressed, not ARN-addressed).
 */
const content = `---
AWSTemplateFormatVersion: "2010-09-09"
Description: >-
  Workflow Studio "DynamicParallelProcessing" starter pack infra (stripped of
  the original Step Functions state machine - see
  dynamicParallelProcessing.cfn.yaml.ts's header comment for what changed and
  why, INCLUDING the deliberate removal of the SNSKey's DeletionPolicy).
Resources:
  DDBTable:
    Type: AWS::DynamoDB::Table
    Properties:
      ProvisionedThroughput:
        ReadCapacityUnits: "1"
        WriteCapacityUnits: "1"
      AttributeDefinitions:
        - AttributeName: "MessageId"
          AttributeType: "S"
      KeySchema:
        - AttributeName: "MessageId"
          KeyType: "HASH"
  SQSQueue:
    Type: AWS::SQS::Queue
  SNSTopic:
    Type: AWS::SNS::Topic
    Properties:
      KmsMasterKeyId: !Ref SNSKeyAlias
  SNSKey:
    Type: AWS::KMS::Key
    Properties:
      Enabled: true
      KeyPolicy: {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "Allow access through SNS for all principals in the account that are authorized to use SNS",
                "Effect": "Allow",
                "Principal": {
                    "AWS": "*"
                },
                "Action": [
                    "kms:Encrypt",
                    "kms:Decrypt",
                    "kms:ReEncrypt*",
                    "kms:GenerateDataKey*",
                    "kms:CreateGrant",
                    "kms:DescribeKey"
                ],
                "Resource": "*",
                "Condition": {
                    "StringEquals": {
                        "kms:ViaService": !Sub "sns.\${AWS::Region}.amazonaws.com",
                        "kms:CallerAccount": !Ref "AWS::AccountId"
                    }
                }
            },
            {
                "Sid": "Allow direct access to key metadata to the account",
                "Effect": "Allow",
                "Principal": {
                    "AWS": !Sub "arn:\${AWS::Partition}:iam::\${AWS::AccountId}:root"
                },
                "Action": [
                    "kms:*"
                ],
                "Resource": "*"
            }
        ]
    }
  SNSKeyAlias:
    DependsOn:
      - SNSKey
    Type: AWS::KMS::Alias
    Properties:
      AliasName: !Join ["", ['alias/Stack-', !Ref AWS::StackName, '/sns-key']]
      TargetKeyId:
        Ref: SNSKey
Outputs:
  SQSQueueUrl:
    Value: !Ref SQSQueue
  DDBTableName:
    Value: !Ref DDBTable
  SNSTopicArn:
    Value: !Ref SNSTopic
`;

export default content;
