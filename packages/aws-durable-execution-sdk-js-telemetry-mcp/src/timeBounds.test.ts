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
    ["2026-10-23T18:42:46.5Z", "2026-10-23T18:42:46.500Z"],
    // A leap day in a leap year is a real date.
    ["2028-02-29", "2028-02-29T00:00:00.000Z"],
  ])("rewrites %s as %s", (input, expected) => {
    for (const precision of ["millisecond", "exact"] as const) {
      expect(normalizeTimestamp("since", input, "up", precision)).toBe(
        expected,
      );
      expect(normalizeTimestamp("until", input, "down", precision)).toBe(
        expected,
      );
    }
  });

  it("millisecond precision rounds a finer bound without changing which records it selects", () => {
    // Stored values have millisecond precision. A record stored at .784 is
    // before since .784119, so since moves up to .785. It is before until
    // .784119, so until stays at .784.
    const finer = "2026-10-23T18:42:46.784119Z";
    expect(normalizeTimestamp("since", finer, "up", "millisecond")).toBe(
      "2026-10-23T18:42:46.785Z",
    );
    expect(normalizeTimestamp("until", finer, "down", "millisecond")).toBe(
      "2026-10-23T18:42:46.784Z",
    );
    const stored = "2026-10-23T18:42:46.784Z";
    expect(
      stored >= normalizeTimestamp("since", finer, "up", "millisecond"),
    ).toBe(false);
    expect(
      stored <= normalizeTimestamp("until", finer, "down", "millisecond"),
    ).toBe(true);
    // Digits past the millisecond that are all zero change nothing.
    expect(
      normalizeTimestamp(
        "since",
        "2026-10-23T18:42:46.784000Z",
        "up",
        "millisecond",
      ),
    ).toBe(stored);
    // Rounding up can carry into the next second.
    expect(
      normalizeTimestamp(
        "since",
        "2026-10-23T18:42:46.9991Z",
        "up",
        "millisecond",
      ),
    ).toBe("2026-10-23T18:42:47.000Z");
  });

  it("exact precision keeps the caller's digits for typed time columns", () => {
    // A typed column compares instants, and an existing table can hold values
    // finer than a millisecond (older exporters). So the bound must not move.
    const finer = "2026-10-23T18:42:46.784119Z";
    expect(normalizeTimestamp("since", finer, "up", "exact")).toBe(finer);
    expect(normalizeTimestamp("until", finer, "down", "exact")).toBe(finer);
    // The offset is applied; the sub-millisecond digits are kept.
    expect(
      normalizeTimestamp(
        "since",
        "2026-10-23T11:42:46.784119-07:00",
        "up",
        "exact",
      ),
    ).toBe(finer);
    // Trailing zeros past the millisecond carry no information.
    expect(
      normalizeTimestamp("since", "2026-10-23T18:42:46.784000Z", "up", "exact"),
    ).toBe("2026-10-23T18:42:46.784Z");
  });

  it.each([
    "2026-13-01",
    "2026-00-10",
    "2026-10-00",
    "2026-02-30",
    // 2026 is not a leap year.
    "2026-02-29",
    "2026-04-31",
    "2026-10-23T25:00:00Z",
    "2026-10-23T24:00:00Z",
    "2026-10-23T23:60:00Z",
    "2026-10-23T23:59:60Z",
    // A fraction needs explicit seconds. ISO-8601 reads 18:42.5 as a
    // fractional minute (18:42:30), not as 18:42:00.5.
    "2026-10-23T18:42.5Z",
    "yesterday",
    "2026-10-23'; DROP TABLE x; --",
  ])("rejects %s", (input) => {
    expect(() =>
      normalizeTimestamp("since", input, "up", "millisecond"),
    ).toThrow(/Invalid since/);
  });

  it("keeps text order equal to time order across input forms", () => {
    // Before the rewrite, `…46Z` sorted after `…46.500Z` as text.
    const bounds = [
      "2026-10-23T18:42:46Z",
      "2026-10-23T18:42:46.5Z",
      "2026-10-23T11:42:47-07:00",
    ].map((b) => normalizeTimestamp("since", b, "up", "millisecond"));
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

  it.each([
    ["s3", "starttime >= TIMESTAMP '2026-10-23 18:42:46.784119'"],
    ["aurora", "start_time >= '2026-10-23T18:42:46.784119Z'"],
    ["redshift", "start_time >= '2026-10-23T18:42:46.784119Z'"],
    ["opensearch", "startTime >= '2026-10-23T18:42:46.784119Z'"],
    // DynamoDB compares text, so the bound gets the stored width.
    ["dynamodb", "startTime >= '2026-10-23T18:42:46.785Z'"],
  ])(
    "%s: a finer since keeps the precision its column can compare",
    (dest, expected) => {
      const sql = buildListExecutionsSql(cfgFor(dest), {
        since: "2026-10-23T18:42:46.784119Z",
      });
      expect(sql).toContain(expected);
    },
  );

  it.each(["cloudwatch-logs-exporter", "lambda-log-exporter"])(
    "%s: the stored format in the Logs Insights filter",
    (dest) => {
      const q = buildListExecutionsLogsQuery(cfgFor(dest), params);
      expect(q).toContain('startTime >= "2026-10-23T18:42:46.000Z"');
      expect(q).toContain('startTime <= "2026-10-23T00:00:00.000Z"');
    },
  );
});
