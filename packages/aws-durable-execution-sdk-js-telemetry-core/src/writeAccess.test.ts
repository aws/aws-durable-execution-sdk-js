jest.mock("./aurora", () => ({ runAuroraQuery: jest.fn() }));
jest.mock("./redshift", () => ({ runRedshiftQuery: jest.fn() }));
jest.mock("./athena", () => ({ getTableLocation: jest.fn() }));
jest.mock("./configCore", () => ({ resolveCredentials: jest.fn(() => ({})) }));

import type { TelemetryConfig } from "./configCore";
import { checkWriteAccess } from "./writeAccess";
import { runAuroraQuery } from "./aurora";
import { runRedshiftQuery } from "./redshift";
import { getTableLocation } from "./athena";

function cfg(overrides: Partial<TelemetryConfig>): TelemetryConfig {
  return {
    region: "us-east-1",
    awsProfile: undefined,
    destinationType: "aurora",
    auroraResourceArn: "arn:rds",
    auroraSecretArn: "arn:secret",
    auroraDatabase: "postgres",
    redshiftDatabase: "dev",
    redshiftWorkgroupName: "wg",
    redshiftClusterIdentifier: "",
    redshiftDbUser: "",
    redshiftSecretArn: "",
    athenaDatabase: "db",
    athenaTable: "durable_execution_telemetry",
    athenaOutputLocation: "",
    athenaS3Location: "",
    ...overrides,
  } as TelemetryConfig;
}

/** Queues the three catalog query results: superuser, writable tables, functions. */
function catalog(
  runner: jest.Mock,
  superuser: string,
  writableTables: string[],
  functions: string[] = [],
): void {
  runner
    .mockResolvedValueOnce({ rows: [[superuser]] })
    .mockResolvedValueOnce({ rows: writableTables.map((t) => [t]) })
    .mockResolvedValueOnce({ rows: functions.map((f) => [f]) });
}

beforeEach(() => jest.resetAllMocks());

describe.each([
  ["aurora", runAuroraQuery as jest.Mock],
  ["redshift", runRedshiftQuery as jest.Mock],
] as const)("checkWriteAccess — %s", (destinationType, runner) => {
  const config = cfg({ destinationType });

  it("is read-only when the user is not a superuser and can write no table", async () => {
    catalog(runner, "false", []);
    expect(await checkWriteAccess(config)).toEqual({ status: "read-only" });
  });

  it("reports a superuser", async () => {
    catalog(runner, "true", []);
    expect(await checkWriteAccess(config)).toEqual({
      status: "can-write",
      findings: ["The database user is a superuser."],
    });
  });

  it("names each writable table", async () => {
    catalog(runner, "false", [
      "public.durable_execution_telemetry",
      "app.orders",
    ]);
    expect(await checkWriteAccess(config)).toEqual({
      status: "can-write",
      findings: [
        "The database user can write table public.durable_execution_telemetry.",
        "The database user can write table app.orders.",
      ],
    });
  });

  it("names each function that runs with another role's privileges", async () => {
    catalog(runner, "false", [], ["app.purge(integer)"]);
    expect(await checkWriteAccess(config)).toEqual({
      status: "can-write",
      findings: [
        "A query can call function app.purge(integer), which runs with " +
          "another role's privileges and can write.",
      ],
    });
  });

  it("asks the database about superuser status, table privileges and functions", async () => {
    catalog(runner, "false", []);
    await checkWriteAccess(config);
    const sqls = runner.mock.calls.map(([opts]) => opts.sql as string);
    expect(sqls[0]).toMatch(/super/);
    expect(sqls[1]).toMatch(/has_table_privilege/);
    expect(sqls[2]).toMatch(/prosecdef/);
  });

  it("returns unknown when the database cannot be reached", async () => {
    runner.mockRejectedValue(new Error("connection refused"));
    expect(await checkWriteAccess(config)).toEqual({
      status: "unknown",
      reason: "connection refused",
    });
  });
});

describe("checkWriteAccess — s3", () => {
  const location = getTableLocation as jest.Mock;

  it("is not checked when the workgroup chooses the result location", async () => {
    const r = await checkWriteAccess(cfg({ destinationType: "s3" }));
    expect(r.status).toBe("not-checked");
    expect(location).not.toHaveBeenCalled();
  });

  it("reports result files written inside the table's data location", async () => {
    location.mockResolvedValue("s3://bucket/telemetry");
    const r = await checkWriteAccess(
      cfg({
        destinationType: "s3",
        athenaOutputLocation: "s3://bucket/telemetry/athena-results/",
      }),
    );
    expect(r.status).toBe("can-write");
  });

  it("is read-only when the result location is outside the data location", async () => {
    // No trailing slash on the data location: a plain prefix test would
    // wrongly treat "telemetry-results" as inside "telemetry".
    location.mockResolvedValue("s3://bucket/telemetry");
    const r = await checkWriteAccess(
      cfg({
        destinationType: "s3",
        athenaOutputLocation: "s3://bucket/telemetry-results/",
      }),
    );
    expect(r).toEqual({ status: "read-only" });
  });

  it("uses athenaS3Location when the table does not exist yet", async () => {
    location.mockResolvedValue(undefined);
    const r = await checkWriteAccess(
      cfg({
        destinationType: "s3",
        athenaOutputLocation: "s3://bucket/data/results/",
        athenaS3Location: "s3://bucket/data/",
      }),
    );
    expect(r.status).toBe("can-write");
  });

  it("is not checked when neither the table nor athenaS3Location gives a data location", async () => {
    location.mockResolvedValue(undefined);
    const r = await checkWriteAccess(
      cfg({
        destinationType: "s3",
        athenaOutputLocation: "s3://bucket/results/",
      }),
    );
    expect(r.status).toBe("not-checked");
  });
});

describe("checkWriteAccess — destinations where one SELECT cannot write", () => {
  it.each(["dynamodb", "opensearch", "cloudwatch-logs-exporter"] as const)(
    "%s is not checked",
    async (destinationType) => {
      const r = await checkWriteAccess(cfg({ destinationType }));
      expect(r.status).toBe("not-checked");
      expect(runAuroraQuery).not.toHaveBeenCalled();
      expect(runRedshiftQuery).not.toHaveBeenCalled();
    },
  );
});
