import { Logger } from "@aws-lambda-powertools/logger";
import { createPowertoolsLogger } from "@aws/durable-execution-sdk-js/powertools";

// These tests run the adapter against the real Powertools Logger. The adapter
// depends on how Powertools merges its arguments into one log entry. So a
// change in that merge order in a later Powertools release fails these tests.

const DURABLE_DATA = {
  executionArn: "arn:aws:lambda:us-east-1:123456789012:function:fn",
  requestId: "request-1",
  operationId: "op-1",
  operationName: "charge",
  attempt: 2,
};

function captureEntries(): {
  entries: () => Record<string, unknown>[];
  restore: () => void;
} {
  const stdout = jest.spyOn(process.stdout, "write").mockImplementation();
  const stderr = jest.spyOn(process.stderr, "write").mockImplementation();
  return {
    entries: () =>
      [...stdout.mock.calls, ...stderr.mock.calls].map((call) =>
        JSON.parse(String(call[0])),
      ),
    restore: () => {
      stdout.mockRestore();
      stderr.mockRestore();
    },
  };
}

function createAdapter() {
  const adapter = createPowertoolsLogger(
    new Logger({ serviceName: "adapter-test" }),
  );
  adapter.configureDurableLoggingContext({
    getDurableLogData: () => ({ ...DURABLE_DATA, tenantId: undefined }),
  });
  return adapter;
}

describe("createPowertoolsLogger with the real Powertools Logger", () => {
  let capture: ReturnType<typeof captureEntries>;

  beforeEach(() => {
    capture = captureEntries();
  });

  afterEach(() => {
    capture.restore();
  });

  it("adds the durable metadata at the top level of a string-message entry", () => {
    createAdapter().info("hello", { userId: "u-1" });

    expect(capture.entries()).toStrictEqual([
      {
        level: "INFO",
        message: "hello",
        timestamp: expect.any(String),
        service: "adapter-test",
        sampling_rate: 0,
        ...DURABLE_DATA,
        userId: "u-1",
      },
    ]);
  });

  it("adds the durable metadata to a plain-object-message entry", () => {
    createAdapter().info({ message: "hello", userId: "u-1" });

    expect(capture.entries()).toStrictEqual([
      {
        level: "INFO",
        message: "hello",
        timestamp: expect.any(String),
        service: "adapter-test",
        sampling_rate: 0,
        ...DURABLE_DATA,
        userId: "u-1",
      },
    ]);
  });

  it("lets a caller key in the message object replace the metadata key", () => {
    createAdapter().info({ message: "hello", operationName: "caller" });

    expect(capture.entries()[0].operationName).toBe("caller");
  });

  it("lets a caller key in an extra object replace the metadata key", () => {
    createAdapter().info("hello", { operationName: "caller" });

    expect(capture.entries()[0].operationName).toBe("caller");
  });

  it("keeps the message and the error details of an Error input", () => {
    // The Powertools types do not accept an Error as the first argument, but
    // Powertools accepts it at run time. JavaScript callers can pass one.
    createAdapter().error(new Error("boom") as unknown as string);

    const [entry] = capture.entries();
    expect(entry).toEqual(
      expect.objectContaining({
        level: "ERROR",
        message: "boom",
        ...DURABLE_DATA,
      }),
    );
  });

  it("keeps an Error extra argument under the error key", () => {
    createAdapter().error("failed", new Error("boom"));

    const [entry] = capture.entries();
    expect(entry).toEqual(
      expect.objectContaining({
        message: "failed",
        ...DURABLE_DATA,
        error: expect.objectContaining({ name: "Error", message: "boom" }),
      }),
    );
  });
});
