const mockAppendFile = jest.fn();
const mockWriteFile = jest.fn();
const mockMkdir = jest.fn();

jest.mock("node:fs/promises", () => ({
  appendFile: (...args: unknown[]): unknown => mockAppendFile(...args),
  writeFile: (...args: unknown[]): unknown => mockWriteFile(...args),
  mkdir: (...args: unknown[]): unknown => mockMkdir(...args),
}));

import { FileExporter } from "./file-exporter";
import { makeRecord } from "../test-utils/make-record";

beforeEach(() => {
  mockAppendFile.mockReset().mockResolvedValue(undefined);
  mockWriteFile.mockReset().mockResolvedValue(undefined);
  mockMkdir.mockReset().mockResolvedValue(undefined);
});

describe("FileExporter", () => {
  it("appends a date-partitioned NDJSON line by default", async () => {
    const exporter = new FileExporter({ directory: "/tmp/insight" });

    await exporter.export(makeRecord());

    expect(mockMkdir).toHaveBeenCalledWith("/tmp/insight", {
      recursive: true,
    });
    expect(mockAppendFile).toHaveBeenCalledTimes(1);
    const [filePath, content, encoding] = mockAppendFile.mock.calls[0];
    expect(filePath).toBe("/tmp/insight/2026-07-15.ndjson");
    expect(encoding).toBe("utf-8");
    expect(content.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(content.trimEnd());
    expect(parsed.executionArn).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
    );
    expect(Array.isArray(parsed.operations)).toBe(true);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("writes one pretty-printed JSON file per execution in json mode", async () => {
    const exporter = new FileExporter({
      directory: "/tmp/insight",
      mode: "json",
    });

    await exporter.export(makeRecord({ executionName: "my-exec" }));

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [filePath, content] = mockWriteFile.mock.calls[0];
    expect(filePath).toBe("/tmp/insight/my-exec.json");
    // Pretty printed with 2-space indentation.
    expect(content).toContain("\n  ");
    expect(JSON.parse(content).executionName).toBe("my-exec");
    expect(mockAppendFile).not.toHaveBeenCalled();
  });
});
