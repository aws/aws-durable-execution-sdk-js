/**
 * `describe_schema` returns guidance produced by a function SHARED with the VS
 * Code extension (`buildSystemPrompt`). That function closes by instructing the
 * model to call `emit_query` -- a tool that exists in the extension's own LLM
 * loop and does NOT exist in this MCP host. An agent that followed it would call
 * an unknown tool and stall.
 *
 * This was found by running `describe_schema` against a real Aurora destination,
 * not by a unit test: the existing tests asserted the guidance was long and
 * self-consistent, which it was. They could not know that its closing sentence
 * addressed a different host. Hence these tests, which assert the guidance names
 * only tools that exist here.
 */
import { buildDescribeSchemaResult } from "./tools";
import { TOOL_DESCRIPTIONS } from "./tools";
import type { InsightConfig } from "durable-insight-core";
import { configFromWireSettings } from "durable-insight-core";

/** Every destination `describe_schema` supports. */
const SUPPORTED = [
  "s3",
  "dynamodb",
  "aurora",
  "redshift",
  "opensearch",
  "cloudwatch-logs-exporter",
  "lambda-log-exporter",
] as const;

function cfgFor(destinationType: string): InsightConfig {
  return configFromWireSettings({
    destinationType,
    region: "us-east-1",
    athenaDatabase: "insights",
    athenaTable: "workflow_insight",
    athenaWorkgroup: "primary",
    dynamodbTableName: "records",
    auroraResourceArn: "arn:aws:rds:us-east-1:1:cluster:c",
    auroraSecretArn: "arn:aws:secretsmanager:us-east-1:1:secret:s",
    auroraTable: "workflow_insight",
    redshiftWorkgroupName: "wg",
    redshiftTable: "workflow_insight",
    opensearchEndpoint: "https://example.us-east-1.es.amazonaws.com",
    opensearchIndex: "workflow-insight",
    logGroupName: "/aws/lambda/fn",
  });
}

/**
 * Tool names that belong to the extension's LLM loop, not to this server. If
 * `describe_schema` mentions one, an agent will try to call it.
 */
const FOREIGN_TOOLS = ["emit_query", "emit_chart", "run_query_tool"];

describe("describe_schema names only tools that exist in this host", () => {
  it.each(SUPPORTED)(
    "%s: guidance mentions no foreign tool",
    (destinationType) => {
      const { guidance } = buildDescribeSchemaResult(cfgFor(destinationType));
      for (const foreign of FOREIGN_TOOLS) {
        expect(guidance).not.toContain(foreign);
      }
    },
  );

  it.each(SUPPORTED)("%s: guidance is still substantial", (destinationType) => {
    // Guard against "fixing" the above by returning an empty string: stripping
    // the closing instruction must not gut the schema knowledge, which is the
    // whole value of this tool.
    const { guidance, guidanceLength } = buildDescribeSchemaResult(
      cfgFor(destinationType),
    );
    expect(guidance.length).toBeGreaterThan(1500);
    expect(guidanceLength).toBe(guidance.length);
  });

  it.each(SUPPORTED)(
    "%s: howToRun points at real tools and states the cap",
    (destinationType) => {
      const { howToRun, maxRows } = buildDescribeSchemaResult(
        cfgFor(destinationType),
      );
      const real = TOOL_DESCRIPTIONS.map((t) => t.name);
      expect(howToRun).toContain("query");
      // Every tool howToRun names must actually be registered.
      for (const word of howToRun.match(/"([a-z_]+)"/g) ?? []) {
        const name = word.replace(/"/g, "");
        expect(real).toContain(name);
      }
      expect(howToRun).toContain(String(maxRows));
    },
  );

  it("keeps the schema content that precedes the stripped instruction", () => {
    // The Aurora guidance's distinctive content must survive stripping -- this is
    // the real-world case that exposed the bug.
    const { guidance } = buildDescribeSchemaResult(cfgFor("aurora"));
    expect(guidance).toContain("record_json");
    expect(guidance).toContain("workflow_insight");
    expect(guidance).not.toContain("emit_query");
  });
});
