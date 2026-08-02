/**
 * CloudFormation template for the "WaitForCallback" Step Functions starter
 * pack (id "cbt"), STRIPPED of its original Step-Functions-specific
 * orchestration.
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/templates/WaitForCallback.yaml.ts`, mainline, fetched
 * 2026-07-23. Vendored as a one-time snapshot.
 *
 * Changes from the original template (same pattern as
 * helloLambda.cfn.yaml.ts - see that file's header for the general
 * rationale):
 *  1. Removed `WaitForCallbackStateMachine` and its now-orphaned
 *     `StatesExecutionRole`.
 *  2. `LambdaExecutionRole`'s `StatesExecutionPolicy` (scoped to
 *     `states:SendTaskSuccess`/`Failure` on `!Ref WaitForCallbackStateMachine`
 *     - would dangle once that resource is removed) is REPLACED with a
 *     `lambda:SendDurableExecutionCallbackSuccess`/`Failure` policy instead -
 *     `CallbackWithTaskToken`'s rewritten code (below) calls that API, not
 *     Step Functions'.
 *  3. `CallbackWithTaskToken`'s inline code rewritten: was
 *     `require("@aws-sdk/client-sfn")` + `SendTaskSuccessCommand({ output,
 *     taskToken })`; now `require("@aws-sdk/client-lambda")` +
 *     `SendDurableExecutionCallbackSuccessCommand({ CallbackId, Result })`.
 *     The SQS message body shape changes correspondingly: the workflow's
 *     waitForCallback submitter publishes `{ callbackId, ... }`, not ASL's
 *     `{ MessageTitle, TaskToken }`.
 *  4. `SQSQueueDLQ` (dead-letter queue) kept as-is - orchestrator-agnostic.
 *  5. `Outputs` replaced: `StateMachineArn`/`ExecutionInput` -> `SQSQueueUrl`
 *     and `SNSTopicArn`, what the imported `.dar` workflow needs.
 */
const content = `---
AWSTemplateFormatVersion: "2010-09-09"
Description: >-
  Workflow Studio "WaitForCallback" starter pack infra (stripped of the
  original Step Functions state machine - see waitForCallback.cfn.yaml.ts's
  header comment for what changed and why).
Resources:
  LambdaExecutionRole:
    Type: "AWS::IAM::Role"
    Properties:
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: "sts:AssumeRole"
      Policies:
        - PolicyName: SQSReceiveMessagePolicy
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: Allow
                Action:
                  - "sqs:ReceiveMessage"
                  - "sqs:DeleteMessage"
                  - "sqs:GetQueueAttributes"
                  - "sqs:ChangeMessageVisibility"
                Resource: !GetAtt [SQSQueue, Arn]
        - PolicyName: CloudWatchLogsPolicy
          PolicyDocument:
            Statement:
              - Effect: Allow
                Action:
                  - "logs:CreateLogGroup"
                  - "logs:CreateLogStream"
                  - "logs:PutLogEvents"
                Resource: !Sub "arn:\${AWS::Partition}:logs:*:*:*"
        - PolicyName: DurableExecutionCallbackPolicy
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: Allow
                Action:
                  - "lambda:SendDurableExecutionCallbackSuccess"
                  - "lambda:SendDurableExecutionCallbackFailure"
                Resource: "*"

  SQSQueue:
    Type: "AWS::SQS::Queue"
    Properties:
      SqsManagedSseEnabled: true
      DelaySeconds: 0
      VisibilityTimeout: 30
      RedrivePolicy:
        deadLetterTargetArn: !GetAtt [SQSQueueDLQ, Arn]
        maxReceiveCount: 1

  SQSQueueDLQ:
    Type: "AWS::SQS::Queue"
    Properties:
      DelaySeconds: 0
      VisibilityTimeout: 30

  SNSTopic:
    Type: "AWS::SNS::Topic"
    Properties:
      DisplayName: "WorkflowStudio-CallbackTopic"

  LambdaFunctionEventSourceMapping:
    Type: "AWS::Lambda::EventSourceMapping"
    Properties:
      BatchSize: 10
      Enabled: true
      EventSourceArn: !GetAtt [SQSQueue, Arn]
      FunctionName: !GetAtt [CallbackWithTaskToken, Arn]

  CallbackWithTaskToken:
    Type: "AWS::Lambda::Function"
    Properties:
      Handler: "index.handler"
      Role: !GetAtt [ LambdaExecutionRole, Arn ]
      Code:
        ZipFile: |
          console.log('Loading function');
          const { LambdaClient, SendDurableExecutionCallbackSuccessCommand } = require('@aws-sdk/client-lambda');

          exports.handler = async (event, context) => {
              const client = new LambdaClient();

              for (const record of event.Records) {
                  const messageBody = JSON.parse(record.body);
                  const callbackId = messageBody.callbackId;

                  console.log("Approving durable-execution callback " + callbackId);

                  try {
                    const data = await client.send(
                      new SendDurableExecutionCallbackSuccessCommand({
                        CallbackId: callbackId,
                        Result: Buffer.from(JSON.stringify("Callback task completed successfully.")),
                      }),
                    );
                    console.log(data);
                  } catch (err) {
                    console.error(err?.message || err);
                    throw err;
                  }
              }
          };

      Runtime: "nodejs22.x"
      Timeout: 25

Outputs:
  SQSQueueUrl:
    Value: !Ref SQSQueue
  SNSTopicArn:
    Value: !Ref SNSTopic
`;

export default content;
