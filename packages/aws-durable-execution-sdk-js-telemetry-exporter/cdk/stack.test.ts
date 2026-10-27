import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { TelemetryDestinationsStack } from "./stack";

/**
 * The projection.year.range this stack's Glue table is expected to
 * synthesize. Kept as named constants (rather than an inline literal in the
 * assertion) so an accidental edit to the range in stack.ts fails this test
 * with a clear expected-vs-actual diff.
 *
 * This is the *example stack's own* expected range — it is NOT tied to the
 * VS Code extension's athena.ts, which hardcodes its own 2024–2030 for the
 * separate case of a customer pointing the extension at their own bucket.
 * The two are independent copies over different buckets and are not required
 * to match (see the note in athena.ts); this test does not, and is not meant
 * to, detect drift between the two packages — only accidental changes to
 * this stack's range. They happen to share a value today; if you
 * intentionally change this stack's range, update these constants to match.
 */
const EXPECTED_PROJECTION_YEAR_START = 2024;
const EXPECTED_PROJECTION_YEAR_END = 2030;

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
describe("TelemetryDestinationsStack", () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new TelemetryDestinationsStack(app, "TestStack", {
      env: { account: "123456789012", region: "us-east-1" },
    });
    template = Template.fromStack(stack);
  });

  it("synthesizes without errors", () => {
    expect(template).toBeDefined();
  });

  it("creates a CloudWatch log group", () => {
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/durable-execution-telemetry/demo",
    });
  });

  it("creates a DynamoDB table with pk key", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "durable-execution-telemetry",
      KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
    });
  });

  it("creates an Aurora Serverless v2 cluster with Data API", () => {
    template.hasResourceProperties("AWS::RDS::DBCluster", {
      EnableHttpEndpoint: true,
    });
  });

  it("creates the Aurora table and widens its columns via custom resources", () => {
    // AuroraCreateTable runs CREATE TABLE IF NOT EXISTS. AuroraWidenColumns
    // widens execution_arn and execution_name on a table an earlier version of
    // this stack created, which CREATE TABLE IF NOT EXISTS leaves unchanged.
    template.resourceCountIs("Custom::AWS", 2);
  });

  it("widens the Aurora columns on create and on update, after the table exists", () => {
    const widen = Object.entries(template.findResources("Custom::AWS")).filter(
      ([id]) => id.startsWith("AuroraWidenColumns"),
    );
    expect(widen).toHaveLength(1);
    const [, resource] = widen[0];
    // Create and Update are CloudFormation-intrinsic JSON strings; flatten them
    // to text to read the SQL they carry.
    const handlers = JSON.stringify([
      resource.Properties.Create,
      resource.Properties.Update,
    ]);
    expect(handlers).toContain("ALTER COLUMN execution_arn TYPE VARCHAR(512)");
    expect(handlers).toContain("ALTER COLUMN execution_name TYPE VARCHAR(256)");
    expect(resource.Properties.Create).toBeDefined();
    expect(resource.Properties.Update).toBeDefined();
    const createTable = Object.keys(template.findResources("Custom::AWS")).find(
      (id) => id.startsWith("AuroraCreateTable"),
    );
    expect(resource.DependsOn).toEqual(expect.arrayContaining([createTable]));
  });

  it("creates an S3 bucket for the S3Exporter destination", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketName: "durable-execution-telemetry-records",
    });
  });

  it("creates a Glue database and table for Athena querying", () => {
    template.hasResourceProperties("AWS::Glue::Database", {
      DatabaseInput: { Name: "durable_execution_telemetry" },
    });
    template.hasResourceProperties("AWS::Glue::Table", {
      DatabaseName: "durable_execution_telemetry",
      TableInput: Match.objectLike({
        Name: "durable_execution_telemetry",
        PartitionKeys: [
          { Name: "year", Type: "string" },
          { Name: "month", Type: "string" },
          { Name: "day", Type: "string" },
        ],
      }),
    });
  });

  it("synthesizes the expected projection.year.range on the Glue table", () => {
    // Regression guard for this stack's own partition-projection range: if
    // someone edits the range in stack.ts, this fails with a clear diff.
    // Not a cross-package check against athena.ts — see the constants'
    // comment above for why those are independent copies.
    template.hasResourceProperties("AWS::Glue::Table", {
      TableInput: Match.objectLike({
        Parameters: Match.objectLike({
          "projection.year.range": `${EXPECTED_PROJECTION_YEAR_START},${EXPECTED_PROJECTION_YEAR_END}`,
        }),
      }),
    });
  });

  it("creates an IAM policy for destinations", () => {
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyName: "DurableExecutionTelemetryDestinations",
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

  it("does not auto-invoke the example function by default", () => {
    // lambda.autoInvoke.enabled is false by default (avoids unexpected
    // recurring, billable invocations). With it off, no EventBridge schedule
    // rule should be synthesized to drive the example function.
    template.resourceCountIs("AWS::Events::Rule", 0);
  });
});
