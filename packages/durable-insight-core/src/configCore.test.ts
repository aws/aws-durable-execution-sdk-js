/**
 * Note the absence of a `vscode` mock: configCore is host-free by design, so
 * this suite importing it without one is itself the assertion that the module
 * stays importable from the desktop host.
 */
jest.mock("@aws-sdk/credential-providers", () => ({
  fromIni: jest.fn(),
  fromNodeProviderChain: jest.fn(),
}));

import {
  DESTINATION_TYPES,
  isDestinationType,
  type DestinationType,
} from "./schema";
import { configFromWireSettings } from "./configCore";

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
 * `DESTINATION_TYPES` is a runtime array that must stay identical to the
 * `DestinationType` union it shadows. Nothing in the compiler enforces the
 * direction that matters: `satisfies readonly DestinationType[]` catches an entry
 * that is NOT a valid type, but adding a member to the union and forgetting the
 * array still compiles -- and would make `isDestinationType` reject a destination
 * the rest of the code supports.
 *
 * The exhaustive switch below is what closes that gap: a new union member makes
 * `assertExhaustive` a compile error, so this file stops building until the array
 * is updated too.
 */
describe("DESTINATION_TYPES matches the DestinationType union", () => {
  it("contains every member of the union, checked exhaustively", () => {
    const seen: DestinationType[] = [];
    const visit = (t: DestinationType): void => {
      switch (t) {
        case "cloudwatch-logs-exporter":
        case "lambda-log-exporter":
        case "dynamodb":
        case "aurora":
        case "redshift":
        case "opensearch":
        case "sqs":
        case "s3":
          seen.push(t);
          return;
        default: {
          // A new union member reaches here and fails to compile, which is the
          // point: the array below cannot silently fall behind the type.
          const assertExhaustive: never = t;
          throw new Error(
            `unhandled destination type: ${String(assertExhaustive)}`,
          );
        }
      }
    };
    for (const t of DESTINATION_TYPES) visit(t);
    expect(seen.sort()).toEqual([...DESTINATION_TYPES].sort());
    // Non-vacuity: an empty array would satisfy the loop above trivially.
    expect(DESTINATION_TYPES.length).toBe(8);
  });

  it("narrows only real destination types", () => {
    for (const t of DESTINATION_TYPES) expect(isDestinationType(t)).toBe(true);
    for (const bad of ["dynamo", "DynamoDB", "", " s3", "athena", "postgres"]) {
      expect(isDestinationType(bad)).toBe(false);
    }
  });
});
