/**
 * A small directory of AWS SDK v3 service clients, used only so the Studio can
 * *search/browse* services before a client is loaded. Operation names and input
 * shapes are NOT listed here — they come from on-demand runtime reflection of
 * the `@aws-sdk/client-*` package (see the host `awsSdkReflect` module). Users
 * can also load any client by typing its package name, so this list only needs
 * to cover common services for discoverability, not be exhaustive.
 *
 * Derived from the public AWS SDK for JavaScript v3 (Apache-2.0). No proprietary
 * console/service assets are vendored.
 */

export interface AwsSdkService {
  /** Package suffix, e.g. "dynamodb" (`@aws-sdk/client-dynamodb`). */
  service: string;
  /** Full client package name. */
  clientPackage: string;
  /** Friendly display label. */
  label: string;
}

function svc(service: string, label: string): AwsSdkService {
  return { service, clientPackage: `@aws-sdk/client-${service}`, label };
}

/** Common services (alphabetical by label). Extend freely. */
export const AWS_SDK_SERVICES: AwsSdkService[] = [
  svc("acm", "ACM (Certificate Manager)"),
  svc("api-gateway", "API Gateway"),
  svc("apigatewayv2", "API Gateway v2"),
  svc("appconfig", "AppConfig"),
  svc("application-auto-scaling", "Application Auto Scaling"),
  svc("athena", "Athena"),
  svc("auto-scaling", "Auto Scaling"),
  svc("backup", "Backup"),
  svc("batch", "Batch"),
  svc("bedrock", "Bedrock"),
  svc("bedrock-agent", "Bedrock Agent"),
  svc("bedrock-agent-runtime", "Bedrock Agent Runtime"),
  svc("bedrock-runtime", "Bedrock Runtime"),
  svc("cloudformation", "CloudFormation"),
  svc("cloudfront", "CloudFront"),
  svc("cloudtrail", "CloudTrail"),
  svc("cloudwatch", "CloudWatch"),
  svc("cloudwatch-events", "CloudWatch Events"),
  svc("cloudwatch-logs", "CloudWatch Logs"),
  svc("codebuild", "CodeBuild"),
  svc("codecommit", "CodeCommit"),
  svc("codedeploy", "CodeDeploy"),
  svc("codepipeline", "CodePipeline"),
  svc("cognito-identity", "Cognito Identity"),
  svc("cognito-identity-provider", "Cognito Identity Provider"),
  svc("comprehend", "Comprehend"),
  svc("config-service", "Config"),
  svc("databrew", "Glue DataBrew"),
  svc("dynamodb", "DynamoDB"),
  svc("dynamodb-streams", "DynamoDB Streams"),
  svc("ebs", "EBS"),
  svc("ec2", "EC2"),
  svc("ecr", "ECR"),
  svc("ecs", "ECS"),
  svc("efs", "EFS"),
  svc("eks", "EKS"),
  svc("elastic-load-balancing-v2", "Elastic Load Balancing v2"),
  svc("elasticache", "ElastiCache"),
  svc("emr", "EMR"),
  svc("eventbridge", "EventBridge"),
  svc("firehose", "Data Firehose"),
  svc("glue", "Glue"),
  svc("iam", "IAM"),
  svc("kinesis", "Kinesis"),
  svc("kms", "KMS"),
  svc("lambda", "Lambda"),
  svc("lex-runtime-v2", "Lex Runtime v2"),
  svc("location", "Location Service"),
  svc("mediaconvert", "MediaConvert"),
  svc("opensearch", "OpenSearch"),
  svc("organizations", "Organizations"),
  svc("polly", "Polly"),
  svc("rds", "RDS"),
  svc("rds-data", "RDS Data"),
  svc("redshift", "Redshift"),
  svc("redshift-data", "Redshift Data"),
  svc("rekognition", "Rekognition"),
  svc("resource-groups-tagging-api", "Resource Groups Tagging API"),
  svc("route-53", "Route 53"),
  svc("s3", "S3"),
  svc("sagemaker", "SageMaker"),
  svc("sagemaker-runtime", "SageMaker Runtime"),
  svc("scheduler", "EventBridge Scheduler"),
  svc("secrets-manager", "Secrets Manager"),
  svc("ses", "SES"),
  svc("sesv2", "SES v2"),
  svc("sfn", "Step Functions"),
  svc("sns", "SNS"),
  svc("sqs", "SQS"),
  svc("ssm", "Systems Manager (SSM)"),
  svc("sts", "STS"),
  svc("textract", "Textract"),
  svc("transcribe", "Transcribe"),
  svc("translate", "Translate"),
  svc("waf-v2", "WAF v2"),
  svc("xray", "X-Ray"),
];

/** True if a string is a syntactically valid `@aws-sdk/client-*` package name. */
export function isAwsSdkClientPackage(pkg: string): boolean {
  return /^@aws-sdk\/client-[a-z0-9-]+$/.test(pkg);
}
