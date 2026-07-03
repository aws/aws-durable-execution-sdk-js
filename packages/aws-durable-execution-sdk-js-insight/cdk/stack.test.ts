import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { InsightDestinationsStack } from "./stack";

/**
 * Basic smoke test: ensures the stack synthesizes without errors.
 * Catches structural issues like missing cfn-response protocols,
 * broken custom resources, or invalid construct trees.
 *
 * NOTE: These assertions are coupled to the default values in config.json
 * (e.g., table names, enabled destinations, resource counts). If you change
 * config.json (e.g., enable Redshift), some tests may need updating.
 * This is intentional for a demo stack — the tests validate the committed
 * default configuration works end-to-end.
 */
describe("InsightDestinationsStack", () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new InsightDestinationsStack(app, "TestStack", {
      env: { account: "123456789012", region: "us-east-1" },
    });
    template = Template.fromStack(stack);
  });

  it("synthesizes without errors", () => {
    expect(template).toBeDefined();
  });

  it("creates a CloudWatch log group", () => {
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/workflow-insight/demo",
    });
  });

  it("creates a DynamoDB table with pk key", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "workflow-insight",
      KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
    });
  });

  it("creates an Aurora Serverless v2 cluster with Data API", () => {
    template.hasResourceProperties("AWS::RDS::DBCluster", {
      EnableHttpEndpoint: true,
    });
  });

  it("creates the Aurora table via custom resource", () => {
    template.resourceCountIs("Custom::AWS", 1);
  });

  it("creates an S3 bucket for the S3Exporter destination", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketName: "workflow-insight-records",
    });
  });

  it("creates a Glue database and table for Athena querying", () => {
    template.hasResourceProperties("AWS::Glue::Database", {
      DatabaseInput: { Name: "workflow_insight" },
    });
    template.hasResourceProperties("AWS::Glue::Table", {
      DatabaseName: "workflow_insight",
      TableInput: Match.objectLike({
        Name: "workflow_insight",
        PartitionKeys: [
          { Name: "year", Type: "string" },
          { Name: "month", Type: "string" },
          { Name: "day", Type: "string" },
        ],
      }),
    });
  });

  it("creates an IAM policy for destinations", () => {
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyName: "WorkflowInsightDestinations",
    });
  });

  it("creates the example Lambda function", () => {
    // Physical name is auto-generated (no fixed FunctionName), so assert on
    // the runtime + handler instead.
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Handler: "index.handler",
    });
  });
});
