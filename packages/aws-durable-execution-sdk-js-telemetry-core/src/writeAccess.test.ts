jest.mock("./aurora", () => ({ runAuroraQuery: jest.fn() }));
jest.mock("./redshift", () => ({ runRedshiftQuery: jest.fn() }));
jest.mock("./athena", () => ({
  getTableLocation: jest.fn(),
  getWorkGroupOutput: jest.fn(),
}));
jest.mock("./configCore", () => ({ resolveCredentials: jest.fn(() => ({})) }));

import { getTableLocation, getWorkGroupOutput } from "./athena";
import { runAuroraQuery } from "./aurora";
import type { TelemetryConfig } from "./configCore";
import { runRedshiftQuery } from "./redshift";
import { checkAthenaResultLocation, checkWriteAccess } from "./writeAccess";

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
    athenaWorkgroup: "",
    athenaOutputLocation: "",
    athenaS3Location: "",
    ...overrides,
  } as TelemetryConfig;
}

const DUTY =
  "It is your responsibility to give these tools read-only credentials.";

/**
 * Queues the catalog query results in the order the engine runs them.
 * Aurora: superuser, tables, sequences, functions. Redshift: superuser,
 * tables, functions.
 */
function catalog(
  destinationType: "aurora" | "redshift",
  rows: {
    superuser?: string;
    tables?: string[];
    sequences?: string[];
    functions?: string[];
  } = {},
): void {
  const runner = (
    destinationType === "aurora" ? runAuroraQuery : runRedshiftQuery
  ) as jest.Mock;
  const toRows = (values: string[] = []) => ({ rows: values.map((v) => [v]) });
  runner.mockResolvedValueOnce({ rows: [[rows.superuser ?? "false"]] });
  runner.mockResolvedValueOnce(toRows(rows.tables));
  if (destinationType === "aurora")
    runner.mockResolvedValueOnce(toRows(rows.sequences));
  runner.mockResolvedValueOnce(toRows(rows.functions));
}

beforeEach(() => jest.resetAllMocks());

describe.each(["aurora", "redshift"] as const)(
  "checkWriteAccess — %s",
  (destinationType) => {
    const config = cfg({ destinationType });
    const runner = (
      destinationType === "aurora" ? runAuroraQuery : runRedshiftQuery
    ) as jest.Mock;

    it("is unverified, never read-only, when nothing is found", async () => {
      catalog(destinationType);
      const r = await checkWriteAccess(config);
      expect(r.status).toBe("unverified");
      expect(r.status === "unverified" && r.reason).toContain(DUTY);
    });

    it("reports a superuser", async () => {
      catalog(destinationType, { superuser: "true" });
      expect(await checkWriteAccess(config)).toEqual({
        status: "can-write",
        findings: ["The database user is a superuser."],
      });
    });

    it("names each writable table", async () => {
      catalog(destinationType, { tables: ["public.t", "app.orders"] });
      expect(await checkWriteAccess(config)).toEqual({
        status: "can-write",
        findings: [
          "The database user can write table public.t.",
          "The database user can write table app.orders.",
        ],
      });
    });

    it("names each function that runs with another role's privileges", async () => {
      catalog(destinationType, { functions: ["app.purge(integer)"] });
      expect(await checkWriteAccess(config)).toEqual({
        status: "can-write",
        findings: [
          "A query can call function app.purge(integer), which runs with " +
            "another role's privileges and can write.",
        ],
      });
    });

    it("is unverified, with the error and the customer's duty, when the database cannot be reached", async () => {
      runner.mockRejectedValue(new Error("connection refused"));
      const r = await checkWriteAccess(config);
      expect(r.status).toBe("unverified");
      expect(r.status === "unverified" && r.reason).toContain(
        "connection refused",
      );
      expect(r.status === "unverified" && r.reason).toContain(DUTY);
    });
  },
);

describe("checkWriteAccess — aurora sequences", () => {
  it("names each sequence the user can advance or reset", async () => {
    catalog("aurora", { sequences: ["public.order_ids"] });
    expect(await checkWriteAccess(cfg({ destinationType: "aurora" }))).toEqual({
      status: "can-write",
      findings: [
        "The database user can advance or reset sequence public.order_ids (nextval/setval).",
      ],
    });
  });

  it("asks about superuser status, tables, sequences and functions, in that order", async () => {
    catalog("aurora");
    await checkWriteAccess(cfg({ destinationType: "aurora" }));
    const sqls = (runAuroraQuery as jest.Mock).mock.calls.map(
      ([o]) => o.sql as string,
    );
    expect(sqls[0]).toMatch(/rolsuper/);
    expect(sqls[1]).toMatch(/has_table_privilege/);
    expect(sqls[2]).toMatch(/has_sequence_privilege\(c\.oid, 'USAGE'\)/);
    expect(sqls[2]).toMatch(/has_sequence_privilege\(c\.oid, 'UPDATE'\)/);
    expect(sqls[3]).toMatch(/prosecdef/);
  });
});

describe("checkWriteAccess — emitted catalog SQL", () => {
  // Redshift reads a backslash in a string literal as an escape, so a LIKE
  // pattern such as 'pg\_%' reaches LIKE as 'pg_%' and skips schemas such as
  // pgdata. The schema filter must therefore not depend on a backslash.
  it.each(["aurora", "redshift"] as const)(
    "%s: no query contains a backslash or a LIKE",
    async (destinationType) => {
      catalog(destinationType);
      await checkWriteAccess(cfg({ destinationType }));
      const runner = (
        destinationType === "aurora" ? runAuroraQuery : runRedshiftQuery
      ) as jest.Mock;
      for (const [opts] of runner.mock.calls) {
        expect(opts.sql).not.toMatch(/\\/);
        expect(opts.sql).not.toMatch(/\bLIKE\b/i);
      }
    },
  );
});

describe("checkAthenaResultLocation", () => {
  const location = getTableLocation as jest.Mock;
  const workgroup = getWorkGroupOutput as jest.Mock;
  const credentials = (() => Promise.resolve({})) as never;
  beforeEach(() => workgroup.mockResolvedValue({ enforced: false }));

  it("is inside when the result location is inside the table's data", async () => {
    location.mockResolvedValue("s3://bucket/telemetry");
    const r = await checkAthenaResultLocation(
      cfg({ athenaOutputLocation: "s3://bucket/telemetry/athena-results/" }),
      credentials,
    );
    expect(r.kind).toBe("inside");
  });

  it("is outside when only a name prefix matches", async () => {
    // A plain prefix test would treat "telemetry-results" as inside "telemetry".
    location.mockResolvedValue("s3://bucket/telemetry");
    const r = await checkAthenaResultLocation(
      cfg({ athenaOutputLocation: "s3://bucket/telemetry-results/" }),
      credentials,
    );
    expect(r).toEqual({ kind: "outside" });
  });

  it("reads the primary workgroup when none is configured", async () => {
    await checkAthenaResultLocation(cfg({}), credentials);
    expect(workgroup).toHaveBeenCalledWith(
      expect.objectContaining({ workgroup: "primary" }),
    );
  });

  it("uses the workgroup's location when the settings set none", async () => {
    workgroup.mockResolvedValue({
      enforced: false,
      outputLocation: "s3://bucket/telemetry/r/",
    });
    location.mockResolvedValue("s3://bucket/telemetry/");
    expect((await checkAthenaResultLocation(cfg({}), credentials)).kind).toBe(
      "inside",
    );
  });

  it("uses an enforced workgroup location instead of the configured one", async () => {
    workgroup.mockResolvedValue({
      enforced: true,
      outputLocation: "s3://bucket/telemetry/r/",
    });
    location.mockResolvedValue("s3://bucket/telemetry/");
    const r = await checkAthenaResultLocation(
      cfg({ athenaWorkgroup: "team", athenaOutputLocation: "s3://elsewhere/" }),
      credentials,
    );
    expect(r.kind).toBe("inside");
    expect(workgroup).toHaveBeenCalledWith(
      expect.objectContaining({ workgroup: "team" }),
    );
  });

  it("uses athenaS3Location when the table does not exist yet", async () => {
    location.mockResolvedValue(undefined);
    const r = await checkAthenaResultLocation(
      cfg({
        athenaOutputLocation: "s3://b/data/results/",
        athenaS3Location: "s3://b/data/",
      }),
      credentials,
    );
    expect(r.kind).toBe("inside");
  });

  it.each([
    ["no result location anywhere", {}, "s3://b/data/"],
    [
      "no data location",
      { athenaOutputLocation: "s3://b/results/" },
      undefined,
    ],
  ] as const)("is undetermined with %s", async (_name, overrides, table) => {
    location.mockResolvedValue(table);
    expect(
      (await checkAthenaResultLocation(cfg(overrides), credentials)).kind,
    ).toBe("undetermined");
  });

  it("is undetermined, with the error, when the workgroup cannot be read", async () => {
    workgroup.mockRejectedValue(new Error("AccessDenied: athena:GetWorkGroup"));
    const r = await checkAthenaResultLocation(
      cfg({ athenaOutputLocation: "s3://b/results/" }),
      credentials,
    );
    expect(r).toEqual({
      kind: "undetermined",
      reason: expect.stringContaining("AccessDenied: athena:GetWorkGroup"),
    });
  });
});

describe("checkWriteAccess — s3", () => {
  const location = getTableLocation as jest.Mock;
  const workgroup = getWorkGroupOutput as jest.Mock;
  beforeEach(() => workgroup.mockResolvedValue({ enforced: false }));

  it("is can-write when results land inside the table's data", async () => {
    location.mockResolvedValue("s3://bucket/telemetry/");
    const r = await checkWriteAccess(
      cfg({
        destinationType: "s3",
        athenaOutputLocation: "s3://bucket/telemetry/r/",
      }),
    );
    expect(r.status).toBe("can-write");
  });

  it("is unverified, never read-only, when results land outside the data", async () => {
    location.mockResolvedValue("s3://bucket/telemetry/");
    const r = await checkWriteAccess(
      cfg({
        destinationType: "s3",
        athenaOutputLocation: "s3://bucket/results/",
      }),
    );
    expect(r.status).toBe("unverified");
    expect(r.status === "unverified" && r.reason).toContain(DUTY);
  });

  it("is unverified with the reason when the location is undetermined", async () => {
    workgroup.mockRejectedValue(new Error("AccessDenied"));
    const r = await checkWriteAccess(
      cfg({
        destinationType: "s3",
        athenaOutputLocation: "s3://bucket/results/",
      }),
    );
    expect(r.status === "unverified" && r.reason).toContain("AccessDenied");
  });
});

describe("checkWriteAccess — destinations no check covers", () => {
  it.each(["dynamodb", "opensearch", "cloudwatch-logs-exporter"] as const)(
    "%s is unverified, never read-only",
    async (destinationType) => {
      const r = await checkWriteAccess(cfg({ destinationType }));
      expect(r.status).toBe("unverified");
      expect(r.status === "unverified" && r.reason).toContain(DUTY);
      expect(runAuroraQuery).not.toHaveBeenCalled();
      expect(runRedshiftQuery).not.toHaveBeenCalled();
    },
  );
});
