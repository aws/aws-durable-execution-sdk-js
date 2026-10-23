/**
 * `list_executions` time bounds.
 *
 * Every SDK writes record timestamps as UTC with exactly 3 fraction digits and a
 * literal `Z`. Some destinations compare those values as text. Text order equals
 * time order only when both sides have the same width and zone. So a bound is
 * rewritten to the stored format before it is compared, and Athena, whose time
 * columns are `timestamp`, gets a typed literal.
 */
import {
  configFromWireSettings,
  type TelemetryConfig,
} from "@aws/durable-execution-sdk-js-telemetry-core";
import { normalizeTimestamp } from "./sqlSafe";
import { buildListExecutionsLogsQuery, buildListExecutionsSql } from "./tools";

function cfgFor(destinationType: string): TelemetryConfig {
  return configFromWireSettings({
    destinationType,
    region: "us-east-1",
    dynamodbTableName: "durable_execution_telemetry",
    athenaDatabase: "db",
    athenaWorkgroup: "primary",
    auroraResourceArn: "arn:aws:rds:us-east-1:123456789012:cluster:c",
    auroraSecretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:s",
    redshiftWorkgroupName: "wg",
    opensearchEndpoint: "https://search-x.us-east-1.es.amazonaws.com",
    logGroupName: "/aws/lambda/fn",
  });
}

describe("normalizeTimestamp", () => {
  it.each([
    // A bound without a fraction gets the stored 3 digits.
    ["2026-10-23T18:42:46Z", "2026-10-23T18:42:46.000Z"],
    // A date alone is midnight UTC.
    ["2026-10-23", "2026-10-23T00:00:00.000Z"],
    // No offset means UTC, because every record timestamp is UTC.
    ["2026-10-23T18:42", "2026-10-23T18:42:00.000Z"],
    ["2026-10-23 18:42:46", "2026-10-23T18:42:46.000Z"],
    // An offset is converted to UTC, with or without the colon.
    ["2026-10-23T11:42:46-07:00", "2026-10-23T18:42:46.000Z"],
    ["2026-10-23T11:42:46-0700", "2026-10-23T18:42:46.000Z"],
    ["2026-10-24 00:12:46+05:30", "2026-10-23T18:42:46.000Z"],
    // More precision than the stored format is cut to milliseconds.
    ["2026-10-23T18:42:46.784119Z", "2026-10-23T18:42:46.784Z"],
    ["2026-10-23T18:42:46.5Z", "2026-10-23T18:42:46.500Z"],
  ])("rewrites %s as %s", (input, expected) => {
    expect(normalizeTimestamp("since", input)).toBe(expected);
  });

  it.each([
    "2026-13-01",
    "2026-10-23T25:00:00Z",
    "yesterday",
    "2026-10-23'; DROP TABLE x; --",
  ])("rejects %s", (input) => {
    expect(() => normalizeTimestamp("since", input)).toThrow(/Invalid since/);
  });

  it("keeps text order equal to time order across input forms", () => {
    // Before the rewrite, `…46Z` sorted after `…46.500Z` as text.
    const bounds = [
      "2026-10-23T18:42:46Z",
      "2026-10-23T18:42:46.5Z",
      "2026-10-23T11:42:47-07:00",
    ].map((b) => normalizeTimestamp("since", b));
    expect([...bounds].sort()).toEqual(bounds);
  });
});

describe("list_executions bounds per destination", () => {
  const params = {
    since: "2026-10-23T11:42:46-07:00",
    until: "2026-10-23",
  };

  it("s3 (Athena): TIMESTAMP literals in UTC for the timestamp column", () => {
    const sql = buildListExecutionsSql(cfgFor("s3"), params);
    expect(sql).toContain("starttime >= TIMESTAMP '2026-10-23 18:42:46.000'");
    expect(sql).toContain("starttime <= TIMESTAMP '2026-10-23 00:00:00.000'");
  });

  it.each([
    ["dynamodb", "startTime"],
    ["aurora", "start_time"],
    ["redshift", "start_time"],
    ["opensearch", "startTime"],
  ])("%s: the stored format as a quoted string", (dest, column) => {
    const sql = buildListExecutionsSql(cfgFor(dest), params);
    expect(sql).toContain(`${column} >= '2026-10-23T18:42:46.000Z'`);
    expect(sql).toContain(`${column} <= '2026-10-23T00:00:00.000Z'`);
  });

  it.each(["cloudwatch-logs-exporter", "lambda-log-exporter"])(
    "%s: the stored format in the Logs Insights filter",
    (dest) => {
      const q = buildListExecutionsLogsQuery(cfgFor(dest), params);
      expect(q).toContain('startTime >= "2026-10-23T18:42:46.000Z"');
      expect(q).toContain('startTime <= "2026-10-23T00:00:00.000Z"');
    },
  );
});
