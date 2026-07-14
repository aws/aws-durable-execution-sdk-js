jest.mock("vscode", () => ({ workspace: { getConfiguration: jest.fn() } }), {
  virtual: true,
});
jest.mock("@aws-sdk/credential-providers", () => ({
  fromIni: jest.fn(),
  fromNodeProviderChain: jest.fn(),
}));

import { configFromWireSettings } from "./config";

describe("configFromWireSettings", () => {
  it("applies defaults for an empty payload", () => {
    const cfg = configFromWireSettings({});
    expect(cfg.destinationType).toBe("cloudwatch-logs-exporter");
    expect(cfg.athenaTable).toBe("workflow_insight");
    expect(cfg.auroraDatabase).toBe("postgres");
    expect(cfg.agenticMaxIterations).toBe(8);
    expect(cfg.logGroupNames).toEqual([]);
  });

  it("maps Athena/S3 fields from the wire payload", () => {
    const cfg = configFromWireSettings({
      destinationType: "s3",
      athenaDatabase: "db",
      athenaTable: "t",
      athenaS3Location: "s3://b/p/",
      athenaOutputLocation: "s3://b/results/",
      region: "eu-west-1",
    });
    expect(cfg.destinationType).toBe("s3");
    expect(cfg.athenaDatabase).toBe("db");
    expect(cfg.athenaTable).toBe("t");
    expect(cfg.athenaS3Location).toBe("s3://b/p/");
    expect(cfg.athenaOutputLocation).toBe("s3://b/results/");
    expect(cfg.region).toBe("eu-west-1");
  });

  it("splits comma-separated log group names", () => {
    const cfg = configFromWireSettings({ logGroupName: "/a, /b ,/c" });
    expect(cfg.logGroupNames).toEqual(["/a", "/b", "/c"]);
  });

  it("coerces the boolean and numeric fields", () => {
    expect(
      configFromWireSettings({ sqsDeleteAfterRead: "true" }).sqsDeleteAfterRead,
    ).toBe(true);
    expect(
      configFromWireSettings({ sqsDeleteAfterRead: "false" })
        .sqsDeleteAfterRead,
    ).toBe(false);
    // clamped to [1, 20]
    expect(
      configFromWireSettings({ agenticMaxIterations: "99" })
        .agenticMaxIterations,
    ).toBe(20);
    expect(
      configFromWireSettings({ agenticMaxIterations: "not-a-number" })
        .agenticMaxIterations,
    ).toBe(8);
  });

  it("leaves awsProfile undefined when blank", () => {
    expect(
      configFromWireSettings({ awsProfile: "" }).awsProfile,
    ).toBeUndefined();
    expect(configFromWireSettings({ awsProfile: "dev" }).awsProfile).toBe(
      "dev",
    );
  });
});
