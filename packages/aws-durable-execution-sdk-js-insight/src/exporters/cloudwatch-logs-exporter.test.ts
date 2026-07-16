const mockSend = jest.fn();

jest.mock("@aws-sdk/client-cloudwatch-logs", () => ({
  CloudWatchLogsClient: jest.fn(() => ({ send: mockSend })),
  PutLogEventsCommand: jest.fn((input: unknown) => ({
    __type: "put",
    __input: input,
  })),
  CreateLogStreamCommand: jest.fn((input: unknown) => ({
    __type: "create",
    __input: input,
  })),
  ResourceAlreadyExistsException: class ResourceAlreadyExistsException extends Error {},
}));

import { CloudWatchLogsExporter } from "./cloudwatch-logs-exporter";
import { ResourceAlreadyExistsException } from "@aws-sdk/client-cloudwatch-logs";
import { makeRecord } from "../test-utils/make-record";

function callsByType(type: string): unknown[] {
  return mockSend.mock.calls.filter((c) => c[0].__type === type);
}

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({});
});

describe("CloudWatchLogsExporter", () => {
  it("creates the dated stream then writes an operationsByName-rendered event", async () => {
    const exporter = new CloudWatchLogsExporter({
      logGroupName: "/insight/records",
      region: "us-east-1",
    });

    await exporter.export(makeRecord());

    const creates = callsByType("create");
    const puts = callsByType("put");
    expect(creates).toHaveLength(1);
    expect(puts).toHaveLength(1);

    const createInput = (
      creates[0] as [
        { __input: { logStreamName: string; logGroupName: string } },
      ]
    )[0].__input;
    expect(createInput.logGroupName).toBe("/insight/records");
    expect(createInput.logStreamName).toMatch(
      /^workflow-insight\/\d{4}\/\d{2}\/\d{2}$/,
    );

    const putInput = (
      puts[0] as [
        {
          __input: { logStreamName: string; logEvents: { message: string }[] };
        },
      ]
    )[0].__input;
    expect(putInput.logStreamName).toBe(createInput.logStreamName);
    const message = JSON.parse(putInput.logEvents[0].message);
    // render = withOperationsByName replaces the array with a name-keyed map.
    expect(message.operationsByName["fetch-user"].count).toBe(1);
    expect(message.operations).toBeUndefined();
  });

  it("creates the stream only once across multiple exports (cache)", async () => {
    const exporter = new CloudWatchLogsExporter({
      logGroupName: "/insight/records",
    });

    await exporter.export(makeRecord());
    await exporter.export(makeRecord());

    expect(callsByType("create")).toHaveLength(1);
    expect(callsByType("put")).toHaveLength(2);
  });

  it("swallows ResourceAlreadyExistsException from CreateLogStream", async () => {
    const exporter = new CloudWatchLogsExporter({
      logGroupName: "/insight/records",
    });

    mockSend.mockImplementation(async (cmd: { __type: string }) => {
      if (cmd.__type === "create") {
        const RAE = ResourceAlreadyExistsException as unknown as new (
          message: string,
        ) => Error;
        throw new RAE("exists");
      }
      return {};
    });

    await expect(exporter.export(makeRecord())).resolves.toBeUndefined();
    expect(callsByType("put")).toHaveLength(1);
  });
});
