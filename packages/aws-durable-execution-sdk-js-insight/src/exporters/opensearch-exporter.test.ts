// Mock SigV4 signing + crypto + credential provider so no real credentials are
// needed; capture the signed request shape. fetch is stubbed per test.
const signMock = jest.fn().mockResolvedValue({
  headers: {
    authorization: "AWS4-HMAC-SHA256 ...",
    host: "d.us-east-1.es.amazonaws.com",
    "content-type": "application/json",
  },
});

jest.mock("@smithy/signature-v4", () => ({
  SignatureV4: jest.fn().mockImplementation(() => ({ sign: signMock })),
}));
jest.mock("@aws-crypto/sha256-js", () => ({ Sha256: jest.fn() }));
jest.mock("@aws-sdk/credential-provider-node", () => ({
  defaultProvider: jest.fn(() => jest.fn()),
}));

import { OpenSearchExporter } from "./opensearch-exporter";
import type { WorkflowInsightRecord } from "../types";

function makeRecord(
  overrides: Partial<WorkflowInsightRecord> = {},
): WorkflowInsightRecord {
  return {
    recordType: "WorkflowInsight",
    schemaVersion: "1.0",
    emittedAt: "2026-07-15T12:00:00.000Z",
    executionArn: "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
    executionName: "exec-1",
    functionName: "fn",
    functionQualifier: "$LATEST",
    region: "us-east-1",
    accountId: "123456789012",
    status: "SUCCEEDED",
    startTime: "2026-07-15T11:59:00.000Z",
    endTime: "2026-07-15T12:00:00.000Z",
    durationMs: 60000,
    input: { orderId: "12345" },
    output: { ok: true },
    operations: [
      {
        id: "o1",
        name: "fetch-user",
        type: "STEP",
        status: "SUCCEEDED",
        durationMs: 5,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  signMock.mockClear();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "",
  });
});

describe("OpenSearchExporter", () => {
  it("PUTs the record to the _doc endpoint keyed by the encoded executionArn (sigv4)", async () => {
    const exporter = new OpenSearchExporter({
      endpoint: "https://d.us-east-1.es.amazonaws.com/",
      region: "us-east-1",
    });

    await exporter.export(makeRecord());

    expect(signMock).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(
      "https://d.us-east-1.es.amazonaws.com/workflow-insight/_doc/" +
        encodeURIComponent(
          "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
        ),
    );
    expect(init.method).toBe("PUT");
    // Signed header set is used verbatim.
    expect(init.headers.authorization).toContain("AWS4-HMAC-SHA256");
    expect(JSON.parse(init.body).executionArn).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
    );
  });

  it("uses HTTP basic auth without signing when auth is basic", async () => {
    const exporter = new OpenSearchExporter({
      endpoint: "https://d.us-east-1.es.amazonaws.com",
      region: "us-east-1",
      auth: "basic",
      username: "admin",
      password: "secret",
      indexName: "custom-index",
    });

    await exporter.export(makeRecord());

    expect(signMock).not.toHaveBeenCalled();
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("/custom-index/_doc/");
    expect(init.headers.Authorization).toBe("Basic " + btoa("admin:secret"));
  });

  it("throws with detail on a non-ok response", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "denied",
    });
    const exporter = new OpenSearchExporter({
      endpoint: "https://d.us-east-1.es.amazonaws.com",
      region: "us-east-1",
    });

    await expect(exporter.export(makeRecord())).rejects.toThrow(/403/);
  });
});
