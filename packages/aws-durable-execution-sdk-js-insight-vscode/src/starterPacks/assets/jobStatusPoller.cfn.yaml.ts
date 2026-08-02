/**
 * CloudFormation template for the "JobStatusPoller" Step Functions starter
 * pack, STRIPPED of its original Step-Functions-specific orchestration.
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/templates/JobStatusPoller.yaml.ts`, mainline, fetched
 * 2026-07-23. Vendored as a one-time snapshot.
 *
 * Changes from the original template:
 *  1. Removed `JobStatusPollerStateMachine` (`AWS::StepFunctions::StateMachine`,
 *     the ASL-embedding resource) and `StatesExecutionRole` (its now-orphaned
 *     execution role, whose only Policy - `lambda:InvokeFunction` for the
 *     state machine to call the two Lambdas - has no remaining consumer once
 *     the state machine is gone) - we deploy the workflow as a durable Lambda
 *     instead (see `jobStatusPoller.dar.template.ts`), which needs its own IAM
 *     permissions (auto-inferred + attached by the existing `deployWorkflow()`
 *     in `../deploy.ts`, not this template).
 *  2. Everything else is kept as faithfully as possible, unmodified, because
 *     none of it is Step-Functions-specific: `LambdaExecutionRole` (grants
 *     `batch:SubmitJob`/`batch:DescribeJobs` - used directly by the two
 *     Lambdas' own boto3 calls, not by Step Functions), `SubmitJobFunction` +
 *     `CheckJobFunction` (plain Python Lambdas the durable workflow's
 *     `context.step` invokes directly via `InvokeCommand` - no task-token /
 *     callback semantics involved here, unlike WaitForCallback's pack, so
 *     their code needs no rewrite), and the full VPC + AWS Batch resource
 *     graph (`SampleVPC`, `SampleInternetGateway`, `PublicRouteTable`,
 *     `SampleVPCGatewayAttachment`, `SampleSecurityGroup`, `SampleSubnet`,
 *     `PublicRoute`, `SampleSubnetRouteTableAssociation`,
 *     `SampleAWSBatchServiceRole`, `SampleIamInstanceProfile`,
 *     `SampleEcsInstanceRole`, `SampleJobDefinition`, `SampleJobQueue`,
 *     `SampleComputeEnvironment`) - the real infra a real Batch job submission
 *     needs to run against, orchestrator-agnostic.
 *  3. `Outputs` replaced: `StateMachineArn`/`ExecutionInput` (meaningless
 *     without the state machine) -> `SubmitJobFunctionArn`/`CheckJobFunctionArn`
 *     (what the imported `.dar` workflow's two `step`/`waitForCondition` nodes
 *     invoke directly), plus kept `SampleJobQueueArn`/`SampleJobDefinition`
 *     (the `.dar`'s initial payload needs a real job queue + job definition to
 *     submit a real Batch job against) and dropped `SampleComputeEnvironmentArn`
 *     (nothing downstream references the compute environment directly - the
 *     job queue's `ComputeEnvironmentOrder` already wires it in).
 */
const content = `---
AWSTemplateFormatVersion: "2010-09-09"
Description: >-
  Workflow Studio "JobStatusPoller" starter pack infra (stripped of the
  original Step Functions state machine - see jobStatusPoller.cfn.yaml.ts's
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
        - PolicyName: BatchExecutionPolicy
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: Allow
                Action:
                  - "batch:SubmitJob"
                  - "batch:DescribeJobs"
                Resource: "*"

  SubmitJobFunction:
    Type: "AWS::Lambda::Function"
    Properties:
      Handler: "index.lambda_handler"
      Role: !GetAtt [ LambdaExecutionRole, Arn ]
      Code:
        ZipFile: |
          from __future__ import print_function

          import json
          import boto3

          print('Loading function')
          batch = boto3.client('batch')
          def lambda_handler(event, context):
              # Log the received event
              print("Received event: " + json.dumps(event, indent=2))
              # Get parameters for the SubmitJob call
              # http://docs.aws.amazon.com/batch/latest/APIReference/API_SubmitJob.html
              jobName = event['jobName']
              jobQueue = event['jobQueue']
              jobDefinition = event['jobDefinition']
              # containerOverrides and parameters are optional
              if event.get('containerOverrides'):
                  containerOverrides = event['containerOverrides']
              else:
                  containerOverrides = {}
              if event.get('parameters'):
                  parameters = event['parameters']
              else:
                  parameters = {}

              try:
                  # Submit a Batch Job
                  response = batch.submit_job(jobQueue=jobQueue, jobName=jobName, jobDefinition=jobDefinition,
                                              containerOverrides=containerOverrides, parameters=parameters)
                  # Log response from AWS Batch
                  print("Response: " + json.dumps(response, indent=2))
                  # Return the jobId
                  jobId = response['jobId']
                  return {
                      'jobId': jobId
                  }
              except Exception as e:
                  print(e)
                  message = 'Error submitting Batch Job'
                  print(message)
                  raise Exception(message)
      Runtime: "python3.14"
      Timeout: "25"

  CheckJobFunction:
    Type: "AWS::Lambda::Function"
    Properties:
      Handler: "index.lambda_handler"
      Role: !GetAtt [ LambdaExecutionRole, Arn ]
      Code:
        ZipFile: |
          from __future__ import print_function

          import json
          import boto3

          print('Loading function')

          batch = boto3.client('batch')

          def lambda_handler(event, context):
              # Log the received event
              print("Received event: " + json.dumps(event, indent=2))
              # Get jobId from the event
              jobId = event['jobId']

              try:
                  # Call DescribeJobs
                  response = batch.describe_jobs(jobs=[jobId])
                  # Log response from AWS Batch
                  print("Response: " + json.dumps(response, indent=2))
                  # Return the jobtatus
                  jobStatus = response['jobs'][0]['status']
                  return jobStatus
              except Exception as e:
                  print(e)
                  message = 'Error getting Batch Job status'
                  print(message)
                  raise Exception(message)
      Runtime: "python3.14"
      Timeout: "25"

  SampleVPC:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: 10.0.0.0/16
  SampleInternetGateway:
    Type: AWS::EC2::InternetGateway
    DependsOn: SampleVPC
  PublicRouteTable:
    Type: AWS::EC2::RouteTable
    DependsOn:
    - SampleVPC
    - SampleVPCGatewayAttachment
    Properties:
      VpcId:
        Ref: SampleVPC
  SampleVPCGatewayAttachment:
    Type: AWS::EC2::VPCGatewayAttachment
    DependsOn:
    - SampleVPC
    - SampleInternetGateway
    Properties:
      VpcId:
        Ref: SampleVPC
      InternetGatewayId:
        Ref: SampleInternetGateway
  SampleSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: A security group for region-agnostic Batch resources
      VpcId:
        Ref: SampleVPC
  SampleSubnet:
    Type: AWS::EC2::Subnet
    DependsOn: SampleVPCGatewayAttachment
    Properties:
      CidrBlock: 10.0.0.0/24
      VpcId:
        Ref: SampleVPC
      MapPublicIpOnLaunch: 'True'
  PublicRoute:
    Type: AWS::EC2::Route
    DependsOn:
    - PublicRouteTable
    - SampleVPCGatewayAttachment
    Properties:
      RouteTableId:
        Ref: PublicRouteTable
      DestinationCidrBlock: 0.0.0.0/0
      GatewayId:
        Ref: SampleInternetGateway
  SampleSubnetRouteTableAssociation:
    Type: AWS::EC2::SubnetRouteTableAssociation
    Properties:
      RouteTableId:
        Ref: PublicRouteTable
      SubnetId:
        Ref: SampleSubnet
  SampleAWSBatchServiceRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
        - Effect: Allow
          Principal:
            Service: batch.amazonaws.com
          Action: sts:AssumeRole
      ManagedPolicyArns:
      - !Sub 'arn:\${AWS::Partition}:iam::aws:policy/service-role/AWSBatchServiceRole'
  SampleIamInstanceProfile:
    Type: AWS::IAM::InstanceProfile
    Properties:
      Roles:
      - Ref: SampleEcsInstanceRole
  SampleEcsInstanceRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2008-10-17'
        Statement:
        - Sid: ''
          Effect: Allow
          Principal:
            Service: ec2.amazonaws.com
          Action: sts:AssumeRole
      ManagedPolicyArns:
      - !Sub 'arn:\${AWS::Partition}:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role'
  SampleJobDefinition:
    Type: AWS::Batch::JobDefinition
    Properties:
      Type: container
      ContainerProperties:
        Image:
          Fn::Join:
          - ''
          - - 137112412989.dkr.ecr.
            - Ref: AWS::Region
            - ".amazonaws.com/amazonlinux:latest"
        Vcpus: 2
        Memory: 2000
        Command:
        - echo
        - Hello world
      RetryStrategy:
        Attempts: 1
  SampleJobQueue:
    Type: AWS::Batch::JobQueue
    DependsOn:
    - SampleComputeEnvironment
    Properties:
      Priority: 1
      ComputeEnvironmentOrder:
      - Order: 1
        ComputeEnvironment:
          Ref: SampleComputeEnvironment
  SampleComputeEnvironment:
    Type: AWS::Batch::ComputeEnvironment
    DependsOn:
    - SampleSubnet
    - SampleSecurityGroup
    - SampleIamInstanceProfile
    - SampleAWSBatchServiceRole
    Properties:
      Type: MANAGED
      ComputeResources:
        Type: EC2
        MinvCpus: 0
        DesiredvCpus: 0
        MaxvCpus: 64
        InstanceTypes:
        - optimal
        Subnets:
        - Ref: SampleSubnet
        SecurityGroupIds:
        - Ref: SampleSecurityGroup
        InstanceRole:
          Ref: SampleIamInstanceProfile
      ServiceRole:
        Ref: SampleAWSBatchServiceRole

Outputs:
  SubmitJobFunctionArn:
    Value: !GetAtt [ SubmitJobFunction, Arn ]
  CheckJobFunctionArn:
    Value: !GetAtt [ CheckJobFunction, Arn ]
  SampleJobQueueArn:
    Value:
      Ref: SampleJobQueue
  SampleJobDefinition:
    Value:
      Ref: SampleJobDefinition
`;

export default content;
