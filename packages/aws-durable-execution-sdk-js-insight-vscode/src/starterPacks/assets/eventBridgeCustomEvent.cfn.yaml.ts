/**
 * CloudFormation template for the "EventBridgeCustomEvent" Step Functions
 * starter pack, STRIPPED of its original Step-Functions-specific
 * orchestration.
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/templates/EventBridgeCustomEvent.yaml.ts`, mainline, fetched
 * 2026-07-23. Vendored as a one-time snapshot.
 *
 * Changes from the original template:
 *
 *  1. Removed `EventBridgeStateMachine` (`AWS::StepFunctions::StateMachine`,
 *     the ASL-embedding resource) and `EventBridgeWorkflowExecutionRole`
 *     (its now-orphaned execution role, whose only Policy -
 *     `events:PutEvents` on the event bus - has no remaining consumer once
 *     the state machine is gone) - we deploy the workflow as a durable
 *     Lambda instead (see `eventBridgeCustomEvent.dar.template.ts`), which
 *     needs its own IAM permissions (auto-inferred + attached by the
 *     existing `deployWorkflow()` in `../deploy.ts`, not this template).
 *
 *  2. **`EventBridgeEventBus` (`Name: stepfunctions-sampleproject-eventbus`)
 *     and `EventBridgeRule` (`Name: stepfunctions-sampleproject-rule`):
 *     replaced both hardcoded `Name:` literals - a DELIBERATE, EXPLICIT
 *     deviation from the source template's fidelity, not an oversight.**
 *     Event bus names and rule names are account+region-scoped (an
 *     `AWS::Events::EventBus` name must be unique per account/region; a rule
 *     name must be unique per event bus), so a fixed literal name would
 *     collide the moment a second stack from this same pack is deployed
 *     concurrently in the same account/region - e.g. a re-verification run
 *     started before a prior one's `delete-stack` finishes, or two
 *     developers verifying this pack at once.
 *
 *     For `EventBridgeRule`, this means simply omitting `Name` (as every
 *     other vendored pack's per-deployment resources already do - none of
 *     `taskTimer.cfn.yaml.ts`/`dynamicParallelProcessing.cfn.yaml.ts`/
 *     `waitForCallback.cfn.yaml.ts` set an explicit `Name`/`TableName`/
 *     `QueueName`/`TopicName`), letting CloudFormation auto-generate a
 *     unique physical name from the stack name + logical id + a random
 *     suffix.
 *
 *     **`AWS::Events::EventBus` is a real exception to that pattern, found
 *     via an actual failed `create-stack` call (not caught by
 *     `validate-template`, which only checks template syntax, not this
 *     resource-specific requirement): unlike every other resource type used
 *     across all vendored packs, `AWS::Events::EventBus` requires `Name` -
 *     omitting it fails immediately with a generic "Validation failed with
 *     1 error(s)" `CREATE_FAILED` (confirmed by bisecting a minimal
 *     reproduction template down to the bus resource alone).** So instead
 *     of omitting `Name` here, it's derived from the stack name via `!Sub
 *     "${AWS::StackName}-bus"` - still collision-free across concurrent
 *     stacks (CFN stack names are already unique per account/region, and
 *     this pack's orchestrator generates a name with a timestamp suffix -
 *     see `registry.ts`'s `deployStarterPackInfra`), while satisfying the
 *     bus's mandatory-name requirement. The `EventBridgeRule`'s
 *     `EventBusName` property is kept pointing at `!Ref EventBridgeEventBus`
 *     (unchanged mechanism - `!Ref` on an `AWS::Events::EventBus` resolves
 *     to its bus name however that name was assigned, so this keeps working
 *     identically whether the name is a literal, derived, or auto-generated).
 *
 *  3. Kept `LambdaFunction` + `LambdaFunctionRole` (a trivial Node.js Lambda
 *     that just logs the event - a REAL fan-out target we verify was
 *     actually invoked via its CloudWatch Logs) and
 *     `PermissionForEventsToInvokeLambda` (required for EventBridge to
 *     invoke that Lambda target) unchanged. Kept `SQSQueue` +
 *     `SQSQueuePolicy` (another real fan-out target, verified via
 *     `ReceiveMessage` after the run) unchanged.
 *
 *  4. **Dual SQS delivery path - a pre-existing real-world detail of the
 *     original template, not something "fixed" here, but important to
 *     understand when interpreting verification results:** `EventBridgeRule`
 *     fans out to THREE targets - `LambdaFunction`, `SNSTopic`, AND
 *     `SQSQueue` directly. Separately, `SNSTopic` ALSO has an SQS
 *     subscription baked into its own `Subscription` property
 *     (`[{ Endpoint: !GetAtt SQSQueue.Arn, Protocol: sqs }]`), so the SAME
 *     `SQSQueue` receives messages via BOTH paths for every single event
 *     published: (a) directly, as one of the rule's targets, and (b)
 *     indirectly, relayed through the SNS topic's subscription. Expect the
 *     queue to receive **up to 2 messages per published event** (one
 *     direct-from-EventBridge, one relayed-from-SNS with a different
 *     envelope shape) - a single `ReceiveMessage` call may only see one of
 *     the two depending on timing/visibility, so don't assume exactly one
 *     message means only the direct path fired. `SQSQueuePolicy` already
 *     grants `sqs:SendMessage` to both `events.amazonaws.com` (scoped to
 *     `EventBridgeRule`'s ARN) and `sns.amazonaws.com` (scoped to
 *     `SNSTopic`'s ARN) for exactly this reason - kept unchanged.
 *
 *  5. Kept `SNSTopic` + `SNSTopicPolicy` unchanged (encrypted via
 *     `KmsMasterKeyId: !Ref SNSKeyAlias`, publish permission granted to
 *     `events.amazonaws.com` scoped to the topic).
 *
 *  6. **`SNSKey` (`AWS::KMS::Key`): removed the original's
 *     `DeletionPolicy: Retain` line - a DELIBERATE, EXPLICIT deviation from
 *     the source template's fidelity, not an oversight - the exact same
 *     change, for the exact same reason, already made in
 *     `dynamicParallelProcessing.cfn.yaml.ts`.** The original retains this
 *     key on stack deletion, presumably to protect against accidentally
 *     losing the key that encrypts a real/production topic's data (SNS
 *     message bodies encrypted under it would become unrecoverable if the
 *     key were deleted out from under live data). That protection is
 *     exactly backwards for our POC-and-fully-teardown verification
 *     methodology, established across every prior starter pack: these
 *     stacks are deployed, exercised once, and torn down completely, with
 *     zero tolerance for residue left behind after `delete-stack`. A
 *     retained KMS key is precisely such residue - it would silently
 *     survive every teardown, accumulate across repeated verification runs,
 *     and incur ongoing per-key charges for a resource nobody kept a
 *     reference to. Since this vendored asset only ever backs a throwaway
 *     POC deployment (never real production topic data), we remove
 *     `Retain` so the key deletes cleanly along with the rest of the stack.
 *
 *  7. Kept `SNSKeyAlias` (`AWS::KMS::Alias`, unchanged including its
 *     `DependsOn: SNSKey` - still needed since the alias's `TargetKeyId`
 *     references the key).
 *
 *  8. `Outputs` replaced: `StateMachineArn`/`ExecutionInput` (meaningless
 *     without the state machine) -> `EventBusName` (the imported `.dar`
 *     workflow's `Send_Custom_Event` step needs this for `PutEventsCommand`'s
 *     `Entries[].EventBusName`), `LambdaFunctionName` (so a verification run
 *     can locate the fan-out Lambda's CloudWatch Logs), `SQSQueueUrl` (so a
 *     verification run can `ReceiveMessage` against the fan-out queue - see
 *     point 4 above for why up to 2 messages may show up per event), and
 *     `SNSTopicArn` (for completeness/diagnostics, even though the `.dar`
 *     workflow itself never publishes to it directly - EventBridge does,
 *     as a rule target).
 */
const content = `---
AWSTemplateFormatVersion: "2010-09-09"
Description: >-
  Workflow Studio "EventBridgeCustomEvent" starter pack infra (stripped of
  the original Step Functions state machine - see
  eventBridgeCustomEvent.cfn.yaml.ts's header comment for what changed and
  why, INCLUDING the deliberate removal of the SNSKey's DeletionPolicy, the
  event-bus/rule naming-collision fix, and the dual-SQS-delivery-path
  explanation).
Resources:
  EventBridgeEventBus:
    Type: AWS::Events::EventBus
    Properties:
      Name: !Sub "\${AWS::StackName}-bus"
  EventBridgeRule:
    Type: AWS::Events::Rule
    Properties:
      Description: Step Functions Sample Project Event Bus Rule
      EventBusName: !Ref EventBridgeEventBus
      EventPattern:
        source:
          - my.statemachine
        detail-type:
          - MessageFromStepFunctions
      State: ENABLED
      Targets:
        - Arn: !GetAtt [ LambdaFunction, Arn ]
          Id: stepfunctions-sampleproject-lambda-target
        - Arn: !Ref SNSTopic
          Id: stepfunctions-sampleproject-sns-target
        - Arn: !GetAtt [ SQSQueue, Arn ]
          Id: stepfunctions-sampleproject-sqs-target
  LambdaFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: index.handler
      Runtime: nodejs22.x
      Role: !GetAtt [ LambdaFunctionRole, Arn ]
      Code:
        ZipFile: |
          exports.handler = async (event, context) => {
            console.log('event ' + JSON.stringify(event));
            console.log('context ' + JSON.stringify(context));

            return;
          };
  LambdaFunctionRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: 2012-10-17
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: sts:AssumeRole
      Policies:
        - PolicyName: CloudWatchLogsPolicy
          PolicyDocument:
            Statement:
              - Effect: Allow
                Action:
                  - logs:CreateLogGroup
                  - logs:CreateLogStream
                  - logs:PutLogEvents
                Resource: !Sub "arn:\${AWS::Partition}:logs:\${AWS::Region}:\${AWS::AccountId}:*"
  PermissionForEventsToInvokeLambda:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !Ref LambdaFunction
      Action: lambda:InvokeFunction
      Principal: events.amazonaws.com
      SourceArn: !GetAtt [ EventBridgeRule, Arn ]
  SQSQueue:
    Type: AWS::SQS::Queue
  SQSQueuePolicy:
    Type: AWS::SQS::QueuePolicy
    Properties:
      PolicyDocument:
        Statement:
          - Effect: "Allow"
            Principal:
              Service: events.amazonaws.com
            Action:
              - "sqs:SendMessage"
            Resource: !GetAtt [SQSQueue, Arn]
            Condition:
              ArnEquals:
                "aws:SourceArn": !GetAtt [EventBridgeRule, Arn]
          - Effect: "Allow"
            Principal:
              Service: sns.amazonaws.com
            Action:
              - "sqs:SendMessage"
            Resource: !GetAtt [SQSQueue, Arn]
            Condition:
              ArnEquals:
                "aws:SourceArn": !Ref SNSTopic
      Queues:
        - !Ref SQSQueue
  SNSTopic:
    Type: AWS::SNS::Topic
    Properties:
      Subscription:
        - Endpoint: !GetAtt [ SQSQueue, Arn ]
          Protocol: sqs
      KmsMasterKeyId: !Ref SNSKeyAlias
  SNSTopicPolicy:
    Type: AWS::SNS::TopicPolicy
    Properties:
      PolicyDocument:
        Statement:
          - Effect: Allow
            Principal:
              Service: events.amazonaws.com
            Action: 'sns:Publish'
            Resource: !Ref SNSTopic
      Topics:
        - !Ref SNSTopic
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
  EventBusName:
    Value: !Ref EventBridgeEventBus
  LambdaFunctionName:
    Value: !Ref LambdaFunction
  SQSQueueUrl:
    Value: !Ref SQSQueue
  SNSTopicArn:
    Value: !Ref SNSTopic
`;

export default content;
