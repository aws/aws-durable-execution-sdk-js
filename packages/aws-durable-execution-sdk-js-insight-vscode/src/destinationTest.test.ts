const ddbSend = jest.fn();
jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
  DescribeTableCommand: jest.fn((i) => ({ __t: "descTable", i })),
}));
const logsSend = jest.fn();
jest.mock("@aws-sdk/client-cloudwatch-logs", () => ({
  CloudWatchLogsClient: jest.fn(() => ({ send: logsSend })),
  DescribeLogGroupsCommand: jest.fn((i) => ({ __t: "descLog", i })),
}));
const sqsSend = jest.fn();
jest.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: jest.fn(() => ({ send: sqsSend })),
  GetQueueAttributesCommand: jest.fn((i) => ({ __t: "getAttrs", i })),
}));
jest.mock("./athena", () => ({
  tableExists: jest.fn(),
  runAthenaQuery: jest.fn(),
}));
jest.mock("./aurora", () => ({
  runAuroraQuery: jest.fn(),
}));
jest.mock("./redshift", () => ({
  runRedshiftQuery: jest.fn(),
}));
jest.mock("./opensearch", () => ({
  pingOpenSearch: jest.fn(),
}));
jest.mock("./config", () => ({
  resolveCredentials: jest.fn(() => ({})),
}));

import type { InsightConfig } from "./config";
import { testDestination } from "./destinationTest";
import { tableExists, runAthenaQuery } from "./athena";
import { runAuroraQuery } from "./aurora";
import { runRedshiftQuery } from "./redshift";
import { pingOpenSearch } from "./opensearch";

function baseCfg(overrides: Partial<InsightConfig>): InsightConfig {
  return {
    region: "us-east-1",
    logGroupNames: [],
    destinationType: "s3",
    dynamodbTableName: "",
    auroraResourceArn: "",
    auroraSecretArn: "",
    auroraDatabase: "postgres",
    auroraTable: "workflow_insight",
    redshiftWorkgroupName: "",
    redshiftClusterIdentifier: "",
    redshiftDbUser: "",
    redshiftSecretArn: "",
    redshiftDatabase: "dev",
    redshiftTable: "workflow_insight",
    redshiftSchema: "public",
    opensearchEndpoint: "",
    opensearchIndex: "workflow-insight",
    sqsQueueUrl: "",
    sqsDeleteAfterRead: false,
    athenaDatabase: "",
    athenaTable: "workflow_insight",
    athenaWorkgroup: "",
    athenaOutputLocation: "",
    athenaS3Location: "",
    llmProvider: "bedrock",
    awsProfile: undefined,
    bedrockModelId: "m",
    localModel: "m",
    localServerUrl: "u",
    localServerModel: "m",
    agenticMaxIterations: 8,
    queryMode: "agent",
    aiDisclosureAcceptedVersion: "",
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe("testDestination — S3/Athena", () => {
  const complete = {
    destinationType: "s3" as const,
    athenaDatabase: "db",
    athenaTable: "workflow_insight",
    athenaS3Location: "s3://bucket/prefix/",
    athenaOutputLocation: "s3://bucket/athena-results/",
  };

  it("fails on missing required fields without probing AWS", async () => {
    const r = await testDestination(baseCfg({ destinationType: "s3" }));
    expect(r.ok).toBe(false);
    const required = r.checks.find((c) => c.label === "Required fields");
    expect(required?.ok).toBe(false);
    expect(required?.detail).toMatch(/Glue Database/);
    expect(tableExists).not.toHaveBeenCalled();
    expect(runAthenaQuery).not.toHaveBeenCalled();
  });

  it("passes when the table exists and the test query succeeds", async () => {
    (tableExists as jest.Mock).mockResolvedValue(true);
    (runAthenaQuery as jest.Mock).mockResolvedValue({ columns: [], rows: [] });
    const r = await testDestination(baseCfg(complete));
    expect(r.ok).toBe(true);
    expect(runAthenaQuery).toHaveBeenCalledWith(
      expect.objectContaining({ query: "SELECT 1", database: "db" }),
    );
  });

  it("still passes (with a note) when the table doesn't exist yet", async () => {
    (tableExists as jest.Mock).mockResolvedValue(false);
    (runAthenaQuery as jest.Mock).mockResolvedValue({ columns: [], rows: [] });
    const r = await testDestination(baseCfg(complete));
    expect(r.ok).toBe(true);
    const tbl = r.checks.find((c) => c.label === "Glue table exists");
    expect(tbl?.ok).toBe(true);
    expect(tbl?.detail).toMatch(/created automatically when you Save/);
  });

  it("fails when the Athena test query errors (e.g. no result location)", async () => {
    (tableExists as jest.Mock).mockResolvedValue(true);
    (runAthenaQuery as jest.Mock).mockRejectedValue(
      new Error("No output location provided"),
    );
    const r = await testDestination(baseCfg(complete));
    expect(r.ok).toBe(false);
    const q = r.checks.find((c) => c.label.startsWith("Athena test query"));
    expect(q?.ok).toBe(false);
    expect(q?.detail).toMatch(/No output location/);
  });

  it("notes primary-workgroup usage when neither workgroup nor location set", async () => {
    (tableExists as jest.Mock).mockResolvedValue(true);
    (runAthenaQuery as jest.Mock).mockResolvedValue({ columns: [], rows: [] });
    const r = await testDestination(
      baseCfg({
        destinationType: "s3",
        athenaDatabase: "db",
        athenaS3Location: "s3://bucket/prefix/",
      }),
    );
    expect(r.checks.some((c) => c.label === "Query result location")).toBe(
      true,
    );
  });
});

describe("testDestination — DynamoDB", () => {
  it("fails when table name missing", async () => {
    const r = await testDestination(baseCfg({ destinationType: "dynamodb" }));
    expect(r.ok).toBe(false);
    expect(ddbSend).not.toHaveBeenCalled();
  });

  it("passes when DescribeTable succeeds", async () => {
    ddbSend.mockResolvedValue({ Table: { TableStatus: "ACTIVE" } });
    const r = await testDestination(
      baseCfg({ destinationType: "dynamodb", dynamodbTableName: "wi" }),
    );
    expect(r.ok).toBe(true);
    expect(r.checks.at(-1)?.detail).toMatch(/ACTIVE/);
  });

  it("fails when DescribeTable throws", async () => {
    ddbSend.mockRejectedValue(new Error("ResourceNotFoundException"));
    const r = await testDestination(
      baseCfg({ destinationType: "dynamodb", dynamodbTableName: "wi" }),
    );
    expect(r.ok).toBe(false);
    expect(r.checks.at(-1)?.detail).toMatch(/ResourceNotFound/);
  });
});

describe("testDestination — Aurora", () => {
  it("fails when ARNs missing", async () => {
    const r = await testDestination(baseCfg({ destinationType: "aurora" }));
    expect(r.ok).toBe(false);
    expect(runAuroraQuery).not.toHaveBeenCalled();
  });

  it("passes SELECT 1 against the Data API", async () => {
    (runAuroraQuery as jest.Mock).mockResolvedValue({ columns: [], rows: [] });
    const r = await testDestination(
      baseCfg({
        destinationType: "aurora",
        auroraResourceArn: "arn:rds",
        auroraSecretArn: "arn:secret",
        auroraDatabase: "postgres",
      }),
    );
    expect(r.ok).toBe(true);
    expect(runAuroraQuery).toHaveBeenCalledWith(
      expect.objectContaining({ sql: "SELECT 1" }),
    );
  });
});

describe("testDestination — Redshift", () => {
  it("fails when neither workgroup nor cluster is set", async () => {
    const r = await testDestination(baseCfg({ destinationType: "redshift" }));
    expect(r.ok).toBe(false);
    expect(runRedshiftQuery).not.toHaveBeenCalled();
  });

  it("passes SELECT 1 against the Data API (Serverless workgroup)", async () => {
    (runRedshiftQuery as jest.Mock).mockResolvedValue({
      columns: [],
      rows: [],
    });
    const r = await testDestination(
      baseCfg({
        destinationType: "redshift",
        redshiftWorkgroupName: "insight-workgroup",
        redshiftDatabase: "dev",
      }),
    );
    expect(r.ok).toBe(true);
    expect(runRedshiftQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: "SELECT 1",
        workgroupName: "insight-workgroup",
        database: "dev",
      }),
    );
  });

  it("fails when the Data API statement errors", async () => {
    (runRedshiftQuery as jest.Mock).mockRejectedValue(
      new Error("Redshift statement failed: relation does not exist"),
    );
    const r = await testDestination(
      baseCfg({
        destinationType: "redshift",
        redshiftClusterIdentifier: "my-cluster",
        redshiftDatabase: "dev",
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.checks.at(-1)?.detail).toMatch(/relation does not exist/);
  });
});

describe("testDestination — OpenSearch", () => {
  it("fails when endpoint missing", async () => {
    const r = await testDestination(baseCfg({ destinationType: "opensearch" }));
    expect(r.ok).toBe(false);
    expect(pingOpenSearch).not.toHaveBeenCalled();
  });

  it("passes when the SigV4 ping succeeds", async () => {
    (pingOpenSearch as jest.Mock).mockResolvedValue(
      'Connected to cluster "x".',
    );
    const r = await testDestination(
      baseCfg({
        destinationType: "opensearch",
        opensearchEndpoint: "https://d.us-east-1.es.amazonaws.com",
      }),
    );
    expect(r.ok).toBe(true);
    expect(pingOpenSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://d.us-east-1.es.amazonaws.com",
      }),
    );
  });

  it("fails when the ping errors (e.g. 403 not authorized)", async () => {
    (pingOpenSearch as jest.Mock).mockRejectedValue(
      new Error("OpenSearch connection failed (403 Forbidden)"),
    );
    const r = await testDestination(
      baseCfg({
        destinationType: "opensearch",
        opensearchEndpoint: "https://d.us-east-1.es.amazonaws.com",
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.checks.at(-1)?.detail).toMatch(/403/);
  });
});

describe("testDestination — SQS", () => {
  it("fails when queue URL missing", async () => {
    const r = await testDestination(baseCfg({ destinationType: "sqs" }));
    expect(r.ok).toBe(false);
    expect(sqsSend).not.toHaveBeenCalled();
  });

  it("passes when GetQueueAttributes succeeds", async () => {
    sqsSend.mockResolvedValue({
      Attributes: { ApproximateNumberOfMessages: "3" },
    });
    const r = await testDestination(
      baseCfg({
        destinationType: "sqs",
        sqsQueueUrl: "https://sqs/q",
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.checks.at(-1)?.detail).toMatch(/~3 messages/);
  });
});

describe("testDestination — CloudWatch Logs", () => {
  it("fails when no log groups", async () => {
    const r = await testDestination(
      baseCfg({ destinationType: "cloudwatch-logs-exporter" }),
    );
    expect(r.ok).toBe(false);
    expect(logsSend).not.toHaveBeenCalled();
  });

  it("passes when the exact log group is found", async () => {
    logsSend.mockResolvedValue({
      logGroups: [{ logGroupName: "/wi/demo" }],
    });
    const r = await testDestination(
      baseCfg({
        destinationType: "cloudwatch-logs-exporter",
        logGroupNames: ["/wi/demo"],
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("fails when the group name is not an exact match", async () => {
    logsSend.mockResolvedValue({
      logGroups: [{ logGroupName: "/wi/demo-2" }],
    });
    const r = await testDestination(
      baseCfg({
        destinationType: "cloudwatch-logs-exporter",
        logGroupNames: ["/wi/demo"],
      }),
    );
    expect(r.ok).toBe(false);
  });

  it("pages via nextToken to find an exact match beyond the first page", async () => {
    logsSend
      .mockResolvedValueOnce({
        logGroups: [{ logGroupName: "/wi/demo-a" }],
        nextToken: "t1",
      })
      .mockResolvedValueOnce({
        logGroups: [{ logGroupName: "/wi/demo" }],
      });
    const r = await testDestination(
      baseCfg({
        destinationType: "cloudwatch-logs-exporter",
        logGroupNames: ["/wi/demo"],
      }),
    );
    expect(r.ok).toBe(true);
    expect(logsSend).toHaveBeenCalledTimes(2);
  });

  it("treats a missing lambda-log-exporter group as a pass (auto-created)", async () => {
    logsSend.mockResolvedValue({ logGroups: [] });
    const r = await testDestination(
      baseCfg({
        destinationType: "lambda-log-exporter",
        logGroupNames: ["/aws/lambda/my-fn"],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.checks.at(-1)?.detail).toMatch(/first invocation/);
  });
});
