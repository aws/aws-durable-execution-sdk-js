import { HttpExporter } from "./http-exporter";
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
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "",
  });
});

describe("HttpExporter", () => {
  it("POSTs the record as JSON with a Content-Type header by default", async () => {
    const exporter = new HttpExporter({ url: "https://hook.example/insight" });

    await exporter.export(makeRecord());

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://hook.example/insight");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    expect(body.executionArn).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
    );
    expect(Array.isArray(body.operations)).toBe(true);
  });

  it("uses PUT and merges custom headers when configured", async () => {
    const exporter = new HttpExporter({
      url: "https://hook.example/insight",
      method: "PUT",
      headers: { Authorization: "Bearer token123" },
    });

    await exporter.export(makeRecord());

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe("PUT");
    expect(init.headers.Authorization).toBe("Bearer token123");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("throws when the endpoint returns a non-2xx status", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "",
    });
    const exporter = new HttpExporter({ url: "https://hook.example/insight" });

    await expect(exporter.export(makeRecord())).rejects.toThrow(/500/);
  });
});
