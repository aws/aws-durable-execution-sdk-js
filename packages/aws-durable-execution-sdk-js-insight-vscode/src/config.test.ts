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

  it("applies Redshift defaults for an empty payload", () => {
    const cfg = configFromWireSettings({});
    expect(cfg.redshiftDatabase).toBe("dev");
    expect(cfg.redshiftTable).toBe("workflow_insight");
    expect(cfg.redshiftSchema).toBe("public");
    expect(cfg.redshiftWorkgroupName).toBe("");
  });

  it("maps Redshift fields from the wire payload", () => {
    const cfg = configFromWireSettings({
      destinationType: "redshift",
      redshiftWorkgroupName: "insight-workgroup",
      redshiftDatabase: "prod",
      redshiftSchema: "analytics",
      redshiftTable: "wi",
    });
    expect(cfg.destinationType).toBe("redshift");
    expect(cfg.redshiftWorkgroupName).toBe("insight-workgroup");
    expect(cfg.redshiftDatabase).toBe("prod");
    expect(cfg.redshiftSchema).toBe("analytics");
    expect(cfg.redshiftTable).toBe("wi");
  });

  it("maps OpenSearch fields and defaults the index", () => {
    const empty = configFromWireSettings({});
    expect(empty.opensearchIndex).toBe("workflow-insight");
    expect(empty.opensearchEndpoint).toBe("");
    const cfg = configFromWireSettings({
      destinationType: "opensearch",
      opensearchEndpoint: "https://d.us-east-1.es.amazonaws.com",
      opensearchIndex: "wi-index",
    });
    expect(cfg.destinationType).toBe("opensearch");
    expect(cfg.opensearchEndpoint).toBe("https://d.us-east-1.es.amazonaws.com");
    expect(cfg.opensearchIndex).toBe("wi-index");
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

/**
 * The Workflow Studio view is opt-in and has no in-app toggle, so the default
 * matters: a missing key must read as OFF, not as "unset and therefore shown".
 */
describe("showWorkflowStudio", () => {
  it("defaults to false when unset", () => {
    expect(configFromWireSettings({}).showWorkflowStudio).toBe(false);
  });

  it('is true only for the exact string "true"', () => {
    expect(
      configFromWireSettings({ showWorkflowStudio: "true" }).showWorkflowStudio,
    ).toBe(true);
    for (const v of ["false", "1", "yes", "TRUE", ""]) {
      expect(
        configFromWireSettings({ showWorkflowStudio: v }).showWorkflowStudio,
      ).toBe(false);
    }
  });
});

/**
 * Dag mode is opt-in because generated dag code calls a runtime the SDK does not
 * implement. A missing key must therefore read as OFF, not as "unset and
 * therefore permitted".
 */
describe("enableDagMode", () => {
  it("defaults to false when unset", () => {
    expect(configFromWireSettings({}).enableDagMode).toBe(false);
  });

  it('is true only for the exact string "true"', () => {
    expect(
      configFromWireSettings({ enableDagMode: "true" }).enableDagMode,
    ).toBe(true);
    for (const v of ["false", "1", "yes", "TRUE", ""]) {
      expect(configFromWireSettings({ enableDagMode: v }).enableDagMode).toBe(
        false,
      );
    }
  });
});
