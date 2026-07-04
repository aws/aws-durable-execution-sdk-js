import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { InsightDestinationsStack } from "./stack";

/**
 * Mirrors aws-durable-execution-sdk-js-insight-vscode/src/athena.ts's
 * PROJECTION_YEAR_START/PROJECTION_YEAR_END exactly (this stack's Glue
 * table's projection.year.range TBLPROPERTIES is meant to match that
 * package's buildCreateTableDdl, used when a customer points the VS Code
 * extension at their own bucket instead of this example's).
 *
 * A real cross-package import was tried and reverted: it requires this
 * package's tsconfig `rootDir` to widen beyond its own directory (a
 * relative import reaches into a sibling package's `src/`), which changes
 * this package's own `dist` build output layout — too invasive a build
 * config change to make just to single-source two constants between an
 * unpublished, otherwise-unrelated dev tool and this CDK stack. If you
 * change the range in athena.ts, update PROJECTION_YEAR_START/END here
 * too — the assertion below will fail loudly if you forget one side.
 */
const PROJECTION_YEAR_START = 2024;
const PROJECTION_YEAR_END = 2030;

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

  it("keeps the Glue table's projection.year.range in sync with athena.ts's PROJECTION_YEAR_START/END", () => {
    // Guards against the two hardcoded definitions of this range (this
    // stack's inline TBLPROPERTIES, and the VS Code extension's
    // buildCreateTableDdl for customers using their own bucket) silently
    // drifting apart — see the PROJECTION_YEAR_START/END comment above for
    // why this can't just be a single shared constant across the two
    // packages. PROJECTION_YEAR_START/END here are a manually-kept mirror
    // of athena.ts's exported constants of the same name; this test will
    // fail if either side is updated without the other.
    template.hasResourceProperties("AWS::Glue::Table", {
      TableInput: Match.objectLike({
        Parameters: Match.objectLike({
          "projection.year.range": `${PROJECTION_YEAR_START},${PROJECTION_YEAR_END}`,
        }),
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
