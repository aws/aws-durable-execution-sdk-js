/**
 * Contract test (acceptance criterion AC-T3) for the MCP host's environment
 * layer. These assertions are what keep the env-var scheme, the accept/exclude
 * split, and the per-destination required-config notion from silently drifting
 * away from core's shared constants and destinationTest.ts.
 *
 * Tests pass a fake env object into readConfigFromEnv — process.env is never
 * mutated.
 */
import {
  SETTING_KEYS,
  isSettingKey,
  configFromWireSettings,
  type InsightConfig,
  type DestinationType,
} from "@aws/durable-execution-sdk-js-insight-core";
import {
  envVarFor,
  MCP_SETTING_KEYS,
  MCP_EXCLUDED_SETTING_KEYS,
} from "./envKeys";
import { readConfigFromEnv, missingRequiredEnvVars } from "./config";
import { DESTINATION_TYPES } from "@aws/durable-execution-sdk-js-insight-core";

describe("envVarFor", () => {
  it("1. every MCP setting key round-trips to a valid DURABLE_INSIGHT_ variable", () => {
    for (const key of MCP_SETTING_KEYS) {
      const v = envVarFor(key);
      expect(v.length).toBeGreaterThan(0);
      expect(v.startsWith("DURABLE_INSIGHT_")).toBe(true);
      expect(v).toMatch(/^[A-Z0-9_]+$/);
    }
  });

  it("2. is injective over all SETTING_KEYS (no two keys share a variable)", () => {
    const seen = new Map<string, string>();
    for (const key of SETTING_KEYS) {
      const v = envVarFor(key);
      const prior = seen.get(v);
      expect(prior).toBeUndefined(); // a collision would hide a setting
      seen.set(v, key);
    }
    expect(seen.size).toBe(SETTING_KEYS.length);
  });

  it("5. spot-checks exact spellings (guards the conversion rule)", () => {
    expect(envVarFor("athenaDatabase")).toBe("DURABLE_INSIGHT_ATHENA_DATABASE");
    expect(envVarFor("athenaS3Location")).toBe(
      "DURABLE_INSIGHT_ATHENA_S3_LOCATION",
    );
    expect(envVarFor("dynamodbTableName")).toBe(
      "DURABLE_INSIGHT_DYNAMODB_TABLE_NAME",
    );
  });
});

describe("MCP_SETTING_KEYS / MCP_EXCLUDED_SETTING_KEYS partition", () => {
  it("3. exactly partitions SETTING_KEYS (union equal, intersection empty, all real keys)", () => {
    const included = new Set(MCP_SETTING_KEYS);
    const excluded = new Set(MCP_EXCLUDED_SETTING_KEYS);
    const all = new Set<string>(SETTING_KEYS);

    // No key is in both lists.
    for (const k of included) expect(excluded.has(k)).toBe(false);

    // Union equals SETTING_KEYS (same size + every all-key present in one list).
    expect(included.size + excluded.size).toBe(all.size);
    for (const k of all) {
      expect(included.has(k) || excluded.has(k)).toBe(true);
    }

    // No invented keys: everything in either list is a real setting key.
    for (const k of [...included, ...excluded]) {
      expect(isSettingKey(k)).toBe(true);
    }

    // Sanity: the exclusion list is exactly the documented eight.
    expect(excluded.size).toBe(8);
  });
});

describe("readConfigFromEnv — excluded keys", () => {
  // Each excluded key mapped to the config field it would have set and that
  // field's normalized default, so we can prove the env value was NOT applied.
  const EXCLUDED_CASES: Array<{
    key: string;
    envValue: string;
    field: keyof InsightConfig;
    expectedDefault: unknown;
  }> = [
    {
      key: "llmProvider",
      envValue: "copilot",
      field: "llmProvider",
      expectedDefault: "bedrock",
    },
    {
      key: "bedrockModelId",
      envValue: "some-other-model",
      field: "bedrockModelId",
      expectedDefault: "us.anthropic.claude-sonnet-5",
    },
    {
      key: "localModel",
      envValue: "phi-3.5-mini",
      field: "localModel",
      expectedDefault: "llama-3-groq-8b-tool-use",
    },
    {
      key: "localServerUrl",
      envValue: "http://example.com/v1",
      field: "localServerUrl",
      expectedDefault: "http://localhost:11434/v1",
    },
    {
      key: "localServerModel",
      envValue: "some-model",
      field: "localServerModel",
      expectedDefault: "llama3.1",
    },
    {
      key: "agenticMaxIterations",
      envValue: "3",
      field: "agenticMaxIterations",
      expectedDefault: 8,
    },
    {
      key: "queryMode",
      envValue: "query",
      field: "queryMode",
      expectedDefault: "agent",
    },
    {
      key: "aiDisclosureAcceptedVersion",
      envValue: "v99",
      field: "aiDisclosureAcceptedVersion",
      expectedDefault: "",
    },
  ];

  it("4. each excluded key is ignored (default kept) and produces a warning naming its variable", () => {
    for (const c of EXCLUDED_CASES) {
      const varName = envVarFor(c.key);
      const { config, warnings } = readConfigFromEnv({ [varName]: c.envValue });

      // Not applied: the field keeps its normalized default.
      expect(config[c.field]).toBe(c.expectedDefault);

      // Warned: at least one warning names the variable.
      expect(warnings.some((w) => w.includes(varName))).toBe(true);
    }
  });

  it("does not warn when no excluded variable is present", () => {
    const { warnings } = readConfigFromEnv({
      DURABLE_INSIGHT_REGION: "us-east-1",
    });
    expect(warnings).toEqual([]);
  });
});

describe("readConfigFromEnv — AWS fallbacks", () => {
  it("6. AWS_REGION alone sets region; DURABLE_INSIGHT_REGION wins when both set", () => {
    expect(readConfigFromEnv({ AWS_REGION: "eu-west-1" }).config.region).toBe(
      "eu-west-1",
    );
    expect(
      readConfigFromEnv({
        AWS_REGION: "eu-west-1",
        DURABLE_INSIGHT_REGION: "us-east-2",
      }).config.region,
    ).toBe("us-east-2");
  });

  it("6. AWS_PROFILE alone sets profile; DURABLE_INSIGHT_AWS_PROFILE wins when both set", () => {
    expect(readConfigFromEnv({ AWS_PROFILE: "team-a" }).config.awsProfile).toBe(
      "team-a",
    );
    expect(
      readConfigFromEnv({
        AWS_PROFILE: "team-a",
        DURABLE_INSIGHT_AWS_PROFILE: "team-b",
      }).config.awsProfile,
    ).toBe("team-b");
  });
});

describe("missingRequiredEnvVars — every DestinationType", () => {
  // For each destination: the wire settings that make it COMPLETE, and the
  // env-var names expected to be reported when only destinationType is set.
  const CASES: Array<{
    type: DestinationType;
    complete: Record<string, string>;
    expectedMissing: string[];
  }> = [
    {
      type: "cloudwatch-logs-exporter",
      complete: { logGroupName: "/aws/lambda/fn" },
      expectedMissing: [envVarFor("logGroupName")],
    },
    {
      type: "lambda-log-exporter",
      complete: { logGroupName: "/aws/lambda/fn" },
      expectedMissing: [envVarFor("logGroupName")],
    },
    {
      type: "dynamodb",
      complete: { dynamodbTableName: "records" },
      expectedMissing: [envVarFor("dynamodbTableName")],
    },
    {
      type: "s3",
      // Querying Athena needs a RESULTS destination: a workgroup (which
      // carries its own output location) or an explicit output location.
      // athenaS3Location is the SOURCE data bucket, required only to CREATE
      // the table -- something this host never does -- so it is deliberately
      // not required here. Confusing the two would write query result files
      // into the data being queried.
      complete: {
        athenaDatabase: "insights",
        athenaWorkgroup: "primary",
      },
      expectedMissing: [
        envVarFor("athenaDatabase"),
        envVarFor("athenaWorkgroup"),
        envVarFor("athenaOutputLocation"),
      ],
    },
    {
      type: "aurora",
      complete: {
        auroraResourceArn: "arn:aws:rds:...:cluster/c",
        auroraSecretArn: "arn:aws:secretsmanager:...:secret/s",
      },
      expectedMissing: [
        envVarFor("auroraResourceArn"),
        envVarFor("auroraSecretArn"),
      ],
    },
    {
      type: "redshift",
      complete: { redshiftWorkgroupName: "wg" },
      expectedMissing: [
        envVarFor("redshiftWorkgroupName"),
        envVarFor("redshiftClusterIdentifier"),
      ],
    },
    {
      type: "opensearch",
      complete: { opensearchEndpoint: "https://d.us-east-1.es.amazonaws.com" },
      expectedMissing: [envVarFor("opensearchEndpoint")],
    },
    {
      type: "sqs",
      complete: {
        sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/1/q",
      },
      expectedMissing: [envVarFor("sqsQueueUrl")],
    },
  ];

  it("7. reports DURABLE_INSIGHT_ names when required config is absent, and none when complete", () => {
    for (const c of CASES) {
      const incomplete = configFromWireSettings({ destinationType: c.type });
      const reported = missingRequiredEnvVars(incomplete);

      // Every reported item is a DURABLE_INSIGHT_ variable name.
      for (const name of reported) {
        expect(name.startsWith("DURABLE_INSIGHT_")).toBe(true);
      }
      expect(new Set(reported)).toEqual(new Set(c.expectedMissing));

      // A complete config for the same destination reports nothing missing.
      const complete = configFromWireSettings({
        destinationType: c.type,
        ...c.complete,
      });
      expect(missingRequiredEnvVars(complete)).toEqual([]);
    }
  });

  it("covers all eight DestinationType values", () => {
    const covered = new Set(CASES.map((c) => c.type));
    expect(covered.size).toBe(8);
  });
});
/**
 * An unrecognized DESTINATION_TYPE must be reported, not absorbed.
 *
 * THE FAILURE THIS PREVENTS:
 * `normalizeConfig` ends its destination-type resolution in a fallback to
 * "cloudwatch-logs-exporter". In the extension that is correct -- the value comes
 * from a dropdown, so an invalid one is unreachable. Here configuration is
 * environment-only, so a typo is the expected failure mode, and it was silent:
 * DESTINATION_TYPE=dynamo produced a server that reported
 * DURABLE_INSIGHT_LOG_GROUP_NAME as the missing variable to a user who had set
 * every DynamoDB variable correctly. `missingRequiredEnvVars` can never name the
 * real problem, because by the time it runs the typo is gone.
 */
describe("unrecognized destination type is surfaced", () => {
  const findWarning = (warnings: string[]) =>
    warnings.find((w) => w.includes("not a recognized destination type"));

  it.each(["dynamo", "DynamoDB", "athena", "postgres", " s3 x"])(
    "warns for %s",
    (value) => {
      const { warnings } = readConfigFromEnv({
        DURABLE_INSIGHT_DESTINATION_TYPE: value,
      } as NodeJS.ProcessEnv);
      const warning = findWarning(warnings);
      expect(warning).toBeDefined();
      // The value must appear, or the user cannot see their own typo.
      expect(warning).toContain(value);
      // And the valid set, or they cannot fix it without reading the source.
      expect(warning).toContain("dynamodb");
    },
  );

  it.each(DESTINATION_TYPES)("stays silent for the valid type %s", (value) => {
    // Acceptance matters as much as rejection: a check that warned for everything
    // would pass the cases above while making every correct config noisy.
    const { warnings, config } = readConfigFromEnv({
      DURABLE_INSIGHT_DESTINATION_TYPE: value,
    } as NodeJS.ProcessEnv);
    expect(findWarning(warnings)).toBeUndefined();
    expect(config.destinationType).toBe(value);
  });

  it("stays silent when the variable is unset", () => {
    // Unset is not a typo -- it is the documented default, and warning about it
    // would train users to ignore warnings.
    const { warnings } = readConfigFromEnv({} as NodeJS.ProcessEnv);
    expect(findWarning(warnings)).toBeUndefined();
  });

  it("tolerates surrounding whitespace, as normalizeConfig does", () => {
    const { warnings, config } = readConfigFromEnv({
      DURABLE_INSIGHT_DESTINATION_TYPE: "  dynamodb  ",
    } as NodeJS.ProcessEnv);
    expect(findWarning(warnings)).toBeUndefined();
    expect(config.destinationType).toBe("dynamodb");
  });
});

describe("region falls back to both standard AWS variables", () => {
  it("uses AWS_DEFAULT_REGION when AWS_REGION is unset", () => {
    // This function shadows normalizeConfig's own fallback, which reads both. The
    // local copy read only AWS_REGION, making it the narrower of the two.
    const { config } = readConfigFromEnv({
      AWS_DEFAULT_REGION: "eu-west-2",
    } as NodeJS.ProcessEnv);
    expect(config.region).toBe("eu-west-2");
  });

  it("prefers AWS_REGION over AWS_DEFAULT_REGION", () => {
    const { config } = readConfigFromEnv({
      AWS_REGION: "us-west-2",
      AWS_DEFAULT_REGION: "eu-west-2",
    } as NodeJS.ProcessEnv);
    expect(config.region).toBe("us-west-2");
  });

  it("prefers the prefixed variable over both", () => {
    const { config } = readConfigFromEnv({
      DURABLE_INSIGHT_REGION: "ap-south-1",
      AWS_REGION: "us-west-2",
      AWS_DEFAULT_REGION: "eu-west-2",
    } as NodeJS.ProcessEnv);
    expect(config.region).toBe("ap-south-1");
  });
});
