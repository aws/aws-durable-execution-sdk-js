import { OTelExporter } from "./otel-exporter";
import { makeRecord } from "../test-utils/make-record";

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "",
  });
});

describe("OTelExporter", () => {
  it("POSTs an OTLP ExportLogsServiceRequest with the record embedded in the log body", async () => {
    const exporter = new OTelExporter({
      endpoint: "https://otlp.vendor.com/v1/logs",
      headers: { "x-api-key": "k" },
    });

    await exporter.export(makeRecord());

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://otlp.vendor.com/v1/logs");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("k");

    const payload = JSON.parse(init.body);
    const logRecord = payload.resourceLogs[0].scopeLogs[0].logRecords[0];
    // SUCCEEDED maps to severity INFO (9).
    expect(logRecord.severityNumber).toBe(9);
    expect(logRecord.severityText).toBe("SUCCEEDED");
    const body = JSON.parse(logRecord.body.stringValue);
    expect(body.executionArn).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
    );
    const attrs = Object.fromEntries(
      logRecord.attributes.map((a: { key: string; value: unknown }) => [
        a.key,
        a.value,
      ]),
    );
    expect(attrs["workflow.execution_arn"]).toEqual({
      stringValue: "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
    });
  });

  it("maps a FAILED execution to ERROR severity (17)", async () => {
    const exporter = new OTelExporter({
      endpoint: "https://otlp.vendor.com/v1/logs",
    });

    await exporter.export(makeRecord({ status: "FAILED" }));

    const payload = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body,
    );
    const logRecord = payload.resourceLogs[0].scopeLogs[0].logRecords[0];
    expect(logRecord.severityNumber).toBe(17);
    expect(logRecord.severityText).toBe("FAILED");
  });

  it("rejects the unsupported http/protobuf protocol at construction", () => {
    expect(
      () =>
        new OTelExporter({
          endpoint: "https://otlp.vendor.com/v1/logs",
          protocol: "http/protobuf",
        }),
    ).toThrow(/http\/protobuf/);
  });
});
