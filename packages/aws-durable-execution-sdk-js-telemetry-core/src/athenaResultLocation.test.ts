jest.mock("./athena", () => ({
  getTableLocation: jest.fn(),
  getWorkGroupOutput: jest.fn(),
}));

import { getTableLocation, getWorkGroupOutput } from "./athena";
import { checkAthenaResultLocation } from "./athenaResultLocation";
import type { TelemetryConfig } from "./configCore";

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

beforeEach(() => jest.resetAllMocks());

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
