/**
 * CloudFormation template for the "AthenaDataQuery" Step Functions starter
 * pack, STRIPPED of its original Step-Functions-specific orchestration.
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/templates/AthenaDataQuery.yaml.ts`, mainline, fetched
 * 2026-07-23. Vendored as a one-time snapshot.
 *
 * Changes from the original template:
 *  1. Removed `AthenaStateMachine` (`AWS::StepFunctions::StateMachine`, the
 *     ASL-embedding resource) and `AthenaWorkflowExecutionRole` (its now-
 *     orphaned execution role) - we deploy the workflow as a durable Lambda
 *     instead (see `athenaDataQuery.dar.template.ts`), which needs its own
 *     IAM permissions (auto-inferred + attached by the existing
 *     `deployWorkflow()` in `../deploy.ts`, not this template).
 *  2. Kept the entire "self-seeding unique suffix" custom-resource pattern
 *     verbatim - `LambdaForStringGeneration` + `LambdaGenerateStringRole` +
 *     `StringGenerationLambda` (an `AWS::CloudFormation::CustomResource`)
 *     generate a random lowercase-alphanumeric suffix once, at stack-create
 *     time, purely so `LogBucket`/`GlueDatabase`/`AthenaWorkGroup`/
 *     `GlueCrawler`'s names are globally unique - none of this is
 *     Step-Functions-specific, and it is the cleanest way to get a
 *     guaranteed-unique suffix without inventing our own orchestration code
 *     for it (same precedent as `dynamicParallelProcessing.cfn.yaml.ts`).
 *  3. Kept `LogBucket` (S3, AES256-encrypted, versioned), `GlueDatabase`,
 *     `AthenaWorkGroup` (result location `s3://<LogBucket>/result`), and
 *     `GlueCrawler` + `GlueCrawlerExecutionRole` (crawls
 *     `s3://<LogBucket>/log`) unchanged - none of these are
 *     Step-Functions-specific; the durable Lambda's own step code talks to
 *     Glue/Athena directly via `@aws-sdk/client-glue` /
 *     `@aws-sdk/client-athena`.
 *  4. Kept `LambdaForDataGeneration` + `LambaForDataGenerationExecutionRole`
 *     unchanged - a plain Lambda that writes a small sample CSV to
 *     `s3://<LogBucket>/log/log.csv`. It remains a Lambda the durable
 *     workflow's `context.step` invokes directly via `InvokeCommand` (its
 *     first real step, matching the ASL's own "Generate example log" state)
 *     - NOT converted to a deploy-time custom resource, since the ASL itself
 *     invokes it as part of the workflow, not at template-provisioning time.
 *  5. **`SNSKey` (`AWS::KMS::Key`): removed the original's
 *     `DeletionPolicy: Retain` line - a DELIBERATE, EXPLICIT deviation from
 *     the source template's fidelity, not an oversight, same precedent as
 *     `dynamicParallelProcessing.cfn.yaml.ts`/`eventBridgeCustomEvent.cfn.yaml.ts`.**
 *     The original retains this key on stack deletion, presumably to protect
 *     against accidentally losing the key that encrypts a real/production
 *     topic's data. That protection is exactly backwards for our
 *     POC-and-fully-teardown verification methodology, established across
 *     every prior starter pack: these stacks are deployed, exercised once,
 *     and torn down completely, with zero tolerance for residue left behind
 *     after `delete-stack`. A retained KMS key is precisely such residue -
 *     it would silently survive every teardown, accumulate across repeated
 *     verification runs, and incur ongoing per-key charges for a resource
 *     nobody kept a reference to. Since this vendored asset only ever backs
 *     a throwaway POC deployment (never real production topic data), we
 *     remove `Retain` so the key deletes cleanly along with the rest of the
 *     stack. `SNSTopic` and `SNSKeyAlias` are kept unchanged.
 *  6. `Outputs` replaced: `StateMachineArn`/`ExecutionInput` (meaningless
 *     without the state machine) -> `DataGenerationLambdaArn` (the imported
 *     `.dar` workflow's `Generate_Example_Log` step invokes this directly),
 *     `CrawlerName` (`Start_Glue_Crawler`/`Poll_Glue_Crawler` need the
 *     crawler's actual randomized name), `GlueDatabase` (the actual
 *     randomized database name `Start_Athena_Query`'s query string
 *     references), `AthenaWorkgroup` (`Start_Athena_Query`'s `WorkGroup`
 *     argument), and `SNSTopicArn` (`Send_Query_Results`'s `PublishCommand`).
 */
const content = `---
AWSTemplateFormatVersion: "2010-09-09"
Description: >-
  Workflow Studio "AthenaDataQuery" starter pack infra (stripped of the
  original Step Functions state machine - see athenaDataQuery.cfn.yaml.ts's
  header comment for what changed and why, INCLUDING the deliberate removal
  of the SNSKey's DeletionPolicy).
Parameters:
  StringLength:
    Type: String
    Default: 10
  SampleProjectDatabase:
    Type: String
    Default: athena-sample-project-db-
  SampleProjectBucket:
    Type: String
    Default: stepfunctions-athena-sample-project-
  MyCrawlerName:
    Type: String
    Default: athena-sample-project-crawler-
  SampleProjectWorkGroup:
    Type: String
    Default: stepfunctions-athena-sample-project-workgroup-
Resources:
  ###
  # Create a Lambda function that generates a random string
  LambdaForStringGeneration:
    Type: "AWS::Lambda::Function"
    Properties:
      Handler: "index.lambda_handler"
      Role: !GetAtt [ LambdaGenerateStringRole, Arn ]
      Code:
        ZipFile:
          !Sub
          - |-
            import random
            import string
            import http.client
            from urllib.parse import urlparse
            import json
            import uuid

            def send_response(request, response, status=None, reason=None):
                if status is not None:
                    response['Status'] = status

                if reason is not None:
                    response['Reason'] = reason

                if 'ResponseURL' in request and request['ResponseURL']:
                    print(request['ResponseURL'])
                    url = urlparse(request['ResponseURL'])
                    body = json.dumps(response)
                    https = http.client.HTTPSConnection(url.hostname)
                    https.request('PUT', url.path+'?'+url.query, body)

                return response

            def lambda_handler(event, context):
                response = {
                    'StackId': event['StackId'],
                    'RequestId': event['RequestId'],
                    'LogicalResourceId': event['LogicalResourceId'],
                    'Status': 'SUCCESS'
                }

                if 'PhysicalResourceId' in event:
                    response['PhysicalResourceId'] = event['PhysicalResourceId']
                else:
                    response['PhysicalResourceId'] = str(uuid.uuid4())

                if event['RequestType'] == 'Delete':
                    return send_response(event, response)

                random_string = ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(\${stringLength}))

                response['Data'] = {'RandomString': random_string}
                response['Reason'] = 'Successful'
                return send_response(event, response)
          - { stringLength: !Ref StringLength}

      Runtime: "python3.14"
      Timeout: "600"
  LambdaGenerateStringRole:
    Type: 'AWS::IAM::Role'
    Properties:
      AssumeRolePolicyDocument:
        Version: 2012-10-17
        Statement:
          - Action:
              - 'sts:AssumeRole'
            Effect: Allow
            Principal:
              Service:
                - lambda.amazonaws.com
      ManagedPolicyArns:
        - !Sub 'arn:\${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
  ###
  # Generate a random string
  StringGenerationLambda:
    Type: AWS::CloudFormation::CustomResource
    Properties:
      ServiceToken: !GetAtt [ LambdaForStringGeneration, Arn ]
  ###
  # Create a S3 bucket
  LogBucket:
    DependsOn: LambdaForStringGeneration
    Type: AWS::S3::Bucket
    Properties:
      BucketName:
        Fn::Join:
          - ''
          - - !Ref SampleProjectBucket
            - !GetAtt [ StringGenerationLambda, RandomString ]
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256
      VersioningConfiguration:
        Status: Enabled

  ###
  # Create an AWS Glue database
  GlueDatabase:
    DependsOn: LogBucket
    Type: AWS::Glue::Database
    Properties:
      CatalogId: !Ref AWS::AccountId
      DatabaseInput:
        Name:
          Fn::Join:
            - ''
            - - !Ref SampleProjectDatabase
              - !GetAtt [ StringGenerationLambda, RandomString ]
  ###
  # Create an AWS Athena workGroup
  AthenaWorkGroup:
    DependsOn: LogBucket
    Type: AWS::Athena::WorkGroup
    Properties:
      Name: !Join [ "", [!Ref SampleProjectWorkGroup, !GetAtt [ StringGenerationLambda, RandomString ] ] ]
      State: ENABLED
      WorkGroupConfiguration:
        EnforceWorkGroupConfiguration: false
        PublishCloudWatchMetricsEnabled: false
        RequesterPaysEnabled: true
        ResultConfiguration:
          OutputLocation: !Join [ "", ["s3://", !Ref LogBucket, "/result" ] ]
  ###
  # Create an AWS Glue crawler
  GlueCrawler:
    DependsOn: GlueDatabase
    Type: AWS::Glue::Crawler
    Properties:
      DatabaseName:
        Fn::Join:
          - ''
          - - !Ref SampleProjectDatabase
            - !GetAtt [ StringGenerationLambda, RandomString ]
      Name:
        Fn::Join:
          - ''
          - - !Ref MyCrawlerName
            - !GetAtt [ StringGenerationLambda, RandomString ]
      Role: !GetAtt [ GlueCrawlerExecutionRole, Arn ]
      SchemaChangePolicy:
        UpdateBehavior: "UPDATE_IN_DATABASE"
        DeleteBehavior: "LOG"
      Targets:
        S3Targets:
          - Path: !Join [ "", [ !Ref LogBucket, "/log" ] ]
  GlueCrawlerExecutionRole:
    Type: "AWS::IAM::Role"
    Properties:
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal:
              Service: glue.amazonaws.com
            Action: "sts:AssumeRole"
      Policies:
        - PolicyName: GlueCrawlerExecutionPolicy
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: Allow
                Action:
                  - glue:*
                  - s3:GetObject
                  - s3:PutObject
                  - s3:ListBucket
                  - s3:GetBucketLocation
                  - s3:GetBucketAcl
                Resource: "*"
              - Effect: Allow
                Action:
                  - logs:CreateLogGroup
                  - logs:CreateLogStream
                  - logs:PutLogEvents
                Resource: !Sub "arn:\${AWS::Partition}:logs:*:*:/aws-glue/*"
  ###
  # Create a Lambda function to populate the sample log file
  LambdaForDataGeneration:
    Type: "AWS::Lambda::Function"
    Properties:
      Handler: "index.lambda_handler"
      Role: !GetAtt [ LambaForDataGenerationExecutionRole, Arn ]
      Code:
        ZipFile:
          !Sub
          - |-
            import boto3
            import random
            import csv
            import json

            YEAR_RANGE_BEGIN = 0
            YEAR_RANGE_END = 19
            MAKE_RANGE_BEGIN = 0
            MAKE_RANGE_END = 25
            NUM_DATASETS = 20
            BASE_YEAR = 2000
            BASE_MAKE = 65
            year = [BASE_YEAR + i for i in range(NUM_DATASETS)]
            make = [BASE_MAKE + i for i in range(26)]

            def lambda_handler(event, context):
              s3 = boto3.resource('s3')
              columns = [['year', 'grade']]
              datasets = [[year[random.randint(YEAR_RANGE_BEGIN, YEAR_RANGE_END)], chr(make[random.randint(MAKE_RANGE_BEGIN, MAKE_RANGE_END)])] for i in range(NUM_DATASETS)]
              csv_data = columns + datasets

              bucket_name = '\${bucket}'
              bucket = s3.Bucket(bucket_name)

              with open('/tmp/log.csv', 'w') as writeFile:
                  writer = csv.writer(writeFile)
                  writer.writerows(csv_data)

              bucket.upload_file('/tmp/log.csv', 'log/log.csv')

              return {
                  'statusCode': 200,
                  'body': json.dumps({
                      'log': 'log/log.csv',
                  })
              }
          - { bucket: !Ref LogBucket}

      Runtime: "python3.14"
      Timeout: "600"
  LambaForDataGenerationExecutionRole:
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
        - PolicyName: LambaForDataGenerationExecutionPolicy
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: Allow
                Action:
                  - "s3:PutObject"
                Resource: !Join ["/", [!GetAtt LogBucket.Arn, "*"]]
  ###
  # Create a SNS topic
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
      AliasName: !Join ["", ['alias/Stack-',!Ref AWS::StackName,'/sns-key']]
      TargetKeyId:
        Ref: SNSKey
Outputs:
  DataGenerationLambdaArn:
    Value: !GetAtt [ LambdaForDataGeneration, Arn ]
  CrawlerName:
    Value:
      Fn::Join:
        - ''
        - - !Ref MyCrawlerName
          - !GetAtt [ StringGenerationLambda, RandomString ]
  GlueDatabase:
    Value:
      Fn::Join:
        - ''
        - - !Ref SampleProjectDatabase
          - !GetAtt [ StringGenerationLambda, RandomString ]
  AthenaWorkgroup:
    Value: !Ref AthenaWorkGroup
  SNSTopicArn:
    Value: !Ref SNSTopic
`;

export default content;
