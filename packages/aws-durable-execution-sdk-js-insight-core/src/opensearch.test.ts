// Mock the SigV4 signer so no real credentials/crypto are needed; capture the
// signed request shape. fetch is stubbed per test.
const signMock = jest.fn().mockResolvedValue({
  headers: { authorization: "AWS4-HMAC-SHA256 ...", host: "d.example" },
});
jest.mock("@smithy/signature-v4", () => ({
  SignatureV4: jest.fn().mockImplementation(() => ({ sign: signMock })),
}));
jest.mock("@aws-crypto/sha256-js", () => ({ Sha256: jest.fn() }));

import {
  runOpenSearchQuery,
  fetchOpenSearchRecord,
  pingOpenSearch,
  countOpenSearchDocs,
} from "./opensearch";

const conn = {
  region: "us-east-1",
  credentials: {} as never,
  endpoint: "https://d.us-east-1.es.amazonaws.com",
};

function mockFetchOnce(res: {
  ok: boolean;
  status: number;
  statusText?: string;
  body: string;
}) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: res.ok,
    status: res.status,
    statusText: res.statusText ?? "",
    text: async () => res.body,
  });
}

beforeEach(() => {
  global.fetch = jest.fn();
  signMock.mockClear();
});

describe("runOpenSearchQuery", () => {
  it("normalizes schema/datarows into columns, rows, numeric flags", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({
        schema: [
          { name: "status", type: "keyword" },
          { name: "ct", type: "integer" },
          { name: "avg_ms", type: "double" },
        ],
        datarows: [
          ["SUCCEEDED", 10, 42.5],
          ["FAILED", 2, 1000],
        ],
      }),
    });

    const res = await runOpenSearchQuery({ ...conn, sql: "SELECT ..." });
    expect(res.columns).toEqual(["status", "ct", "avg_ms"]);
    expect(res.numericColumns).toEqual([false, true, true]);
    expect(res.rows).toEqual([
      ["SUCCEEDED", "10", "42.5"],
      ["FAILED", "2", "1000"],
    ]);
    expect(res.count).toBe(2);
    // POSTs to the SQL plugin endpoint
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`${conn.endpoint}/_plugins/_sql`);
    expect(init.method).toBe("POST");
  });

  it("throws with the SQL plugin's reason on error responses", async () => {
    mockFetchOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      body: JSON.stringify({
        error: { reason: "Invalid SQL query", details: "..." },
      }),
    });
    await expect(
      runOpenSearchQuery({ ...conn, sql: "SELECT bogus" }),
    ).rejects.toThrow(/Invalid SQL query/);
  });

  it("serializes object cells as JSON", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({
        schema: [{ name: "error", type: "object" }],
        datarows: [[{ name: "Boom", message: "x" }]],
      }),
    });
    const res = await runOpenSearchQuery({ ...conn, sql: "SELECT error" });
    expect(res.rows[0][0]).toBe(JSON.stringify({ name: "Boom", message: "x" }));
  });
});

describe("fetchOpenSearchRecord", () => {
  it("returns undefined on 404", async () => {
    mockFetchOnce({ ok: false, status: 404, body: "" });
    const out = await fetchOpenSearchRecord({
      ...conn,
      index: "workflow-insight",
      executionArn: "arn:missing",
    });
    expect(out).toBeUndefined();
  });

  it("flattens _source into top-level string fields", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({
        _source: {
          executionArn: "arn:1",
          status: "SUCCEEDED",
          input: { claimType: "auto" },
        },
      }),
    });
    const out = await fetchOpenSearchRecord({
      ...conn,
      index: "workflow-insight",
      executionArn: "arn:1",
    });
    expect(out!.executionArn).toBe("arn:1");
    expect(out!.status).toBe("SUCCEEDED");
    expect(out!.input).toBe(JSON.stringify({ claimType: "auto" }));
    // GET to the _doc endpoint with URL-encoded id
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("/workflow-insight/_doc/arn%3A1");
    expect(init.method).toBe("GET");
  });
});

describe("pingOpenSearch", () => {
  it("reports the cluster name/version", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({
        cluster_name: "my-cluster",
        version: { number: "2.11.0" },
      }),
    });
    const msg = await pingOpenSearch(conn);
    expect(msg).toMatch(/my-cluster/);
    expect(msg).toMatch(/2\.11\.0/);
  });

  it("throws on a non-ok response", async () => {
    mockFetchOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      body: "no",
    });
    await expect(pingOpenSearch(conn)).rejects.toThrow(/403/);
  });
});

describe("countOpenSearchDocs", () => {
  it("returns the document count and hits <index>/_count", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({ count: 42 }),
    });
    const n = await countOpenSearchDocs(conn, "workflow-insight");
    expect(n).toBe(42);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`${conn.endpoint}/workflow-insight/_count`);
    expect(init.method).toBe("GET");
  });

  it("returns undefined when the index doesn't exist (404)", async () => {
    mockFetchOnce({ ok: false, status: 404, body: "" });
    expect(await countOpenSearchDocs(conn, "missing-index")).toBeUndefined();
  });

  it("throws on other errors", async () => {
    mockFetchOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      body: "denied",
    });
    await expect(countOpenSearchDocs(conn, "workflow-insight")).rejects.toThrow(
      /403/,
    );
  });
});
