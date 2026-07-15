import type { InvocationInfo } from "@aws/durable-execution-sdk-js";
import {
  xRayContextExtractor,
  w3cClientContextExtractor,
} from "../context-extractors";

const baseInfo: InvocationInfo = {
  requestId: "req-123",
  executionArn:
    "arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST/exec/abc",
  isFirstInvocation: true,
  executionInput: {},
  operations: {},
  updatedOperations: {},
  executionStartTimestamp: new Date("2024-01-01T00:00:00Z"),
};

describe("xRayContextExtractor", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns undefined when _X_AMZN_TRACE_ID is not set", () => {
    delete process.env._X_AMZN_TRACE_ID;
    expect(xRayContextExtractor(baseInfo)).toBeUndefined();
  });

  it("extracts traceId and parentSpanId from valid X-Ray header", () => {
    process.env._X_AMZN_TRACE_ID =
      "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1";

    const result = xRayContextExtractor(baseInfo);
    expect(result).toEqual({
      traceId: "5759e988bd862e3fe1be46a994272793",
      parentSpanId: "53995c3f42cd8ad8",
    });
  });

  it("extracts traceId without Parent field", () => {
    process.env._X_AMZN_TRACE_ID =
      "Root=1-5759e988-bd862e3fe1be46a994272793;Sampled=1";

    const result = xRayContextExtractor(baseInfo);
    expect(result).toEqual({
      traceId: "5759e988bd862e3fe1be46a994272793",
      parentSpanId: undefined,
    });
  });

  it("returns undefined for empty string", () => {
    process.env._X_AMZN_TRACE_ID = "";
    expect(xRayContextExtractor(baseInfo)).toBeUndefined();
  });

  it("returns undefined for header without Root field", () => {
    process.env._X_AMZN_TRACE_ID = "Parent=53995c3f42cd8ad8;Sampled=1";
    expect(xRayContextExtractor(baseInfo)).toBeUndefined();
  });

  it("returns undefined for malformed Root field (wrong hex length)", () => {
    process.env._X_AMZN_TRACE_ID = "Root=1-5759e988-bd862e3fe1be46a9;Sampled=1";
    expect(xRayContextExtractor(baseInfo)).toBeUndefined();
  });

  it("returns undefined for Root field with non-hex characters", () => {
    process.env._X_AMZN_TRACE_ID =
      "Root=1-5759e988-ZZZZZZZZZZZZZZZZZZZZZZZZ;Sampled=1";
    expect(xRayContextExtractor(baseInfo)).toBeUndefined();
  });

  it("handles uppercase Parent values by normalizing to lowercase", () => {
    process.env._X_AMZN_TRACE_ID =
      "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995C3F42CD8AD8;Sampled=1";

    const result = xRayContextExtractor(baseInfo);
    expect(result).toEqual({
      traceId: "5759e988bd862e3fe1be46a994272793",
      parentSpanId: "53995c3f42cd8ad8",
    });
  });

  it("ignores invalid Parent field (wrong length)", () => {
    process.env._X_AMZN_TRACE_ID =
      "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=short;Sampled=1";

    const result = xRayContextExtractor(baseInfo);
    expect(result).toEqual({
      traceId: "5759e988bd862e3fe1be46a994272793",
      parentSpanId: undefined,
    });
  });
});

describe("w3cClientContextExtractor", () => {
  it("returns undefined when info has no context", () => {
    expect(w3cClientContextExtractor(baseInfo)).toBeUndefined();
  });

  it("returns undefined when clientContext is missing", () => {
    const info = { ...baseInfo, context: {} } as unknown as InvocationInfo;
    expect(w3cClientContextExtractor(info)).toBeUndefined();
  });

  it("returns undefined when clientContext.custom is missing", () => {
    const info = {
      ...baseInfo,
      context: { clientContext: {} },
    } as unknown as InvocationInfo;
    expect(w3cClientContextExtractor(info)).toBeUndefined();
  });

  it("returns undefined when traceparent is missing from custom", () => {
    const info = {
      ...baseInfo,
      context: { clientContext: { custom: {} } },
    } as unknown as InvocationInfo;
    expect(w3cClientContextExtractor(info)).toBeUndefined();
  });

  it("extracts traceId, parentSpanId, and traceFlags from valid traceparent", () => {
    const info = {
      ...baseInfo,
      context: {
        clientContext: {
          custom: {
            traceparent:
              "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
          },
        },
      },
    } as unknown as InvocationInfo;

    const result = w3cClientContextExtractor(info);
    expect(result).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      parentSpanId: "00f067aa0ba902b7",
      traceFlags: 1,
    });
  });

  it("parses traceFlags=00 as 0", () => {
    const info = {
      ...baseInfo,
      context: {
        clientContext: {
          custom: {
            traceparent:
              "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
          },
        },
      },
    } as unknown as InvocationInfo;

    const result = w3cClientContextExtractor(info);
    expect(result?.traceFlags).toBe(0);
  });

  it("returns undefined for traceparent with wrong number of parts", () => {
    const info = {
      ...baseInfo,
      context: {
        clientContext: {
          custom: {
            traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7",
          },
        },
      },
    } as unknown as InvocationInfo;

    expect(w3cClientContextExtractor(info)).toBeUndefined();
  });

  it("returns undefined for traceparent with invalid traceId length", () => {
    const info = {
      ...baseInfo,
      context: {
        clientContext: {
          custom: {
            traceparent: "00-4bf92f3577b3-00f067aa0ba902b7-01",
          },
        },
      },
    } as unknown as InvocationInfo;

    expect(w3cClientContextExtractor(info)).toBeUndefined();
  });

  it("returns undefined for traceparent with invalid parentId length", () => {
    const info = {
      ...baseInfo,
      context: {
        clientContext: {
          custom: {
            traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067-01",
          },
        },
      },
    } as unknown as InvocationInfo;

    expect(w3cClientContextExtractor(info)).toBeUndefined();
  });

  it("returns undefined for traceparent with non-hex characters", () => {
    const info = {
      ...baseInfo,
      context: {
        clientContext: {
          custom: {
            traceparent:
              "00-ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ-00f067aa0ba902b7-01",
          },
        },
      },
    } as unknown as InvocationInfo;

    expect(w3cClientContextExtractor(info)).toBeUndefined();
  });

  it("returns undefined for traceparent with invalid version", () => {
    const info = {
      ...baseInfo,
      context: {
        clientContext: {
          custom: {
            traceparent:
              "zz-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
          },
        },
      },
    } as unknown as InvocationInfo;

    expect(w3cClientContextExtractor(info)).toBeUndefined();
  });
});
