import type { InvocationInfo } from "@aws/durable-execution-sdk-js";
import {
  xRayContextExtractor,
  w3cClientContextExtractor,
  resolveSampling,
  hasCompleteRemoteParent,
  hasValidTraceId,
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
      sampling: "SAMPLED",
    });
  });

  it("extracts traceId without Parent field", () => {
    process.env._X_AMZN_TRACE_ID =
      "Root=1-5759e988-bd862e3fe1be46a994272793;Sampled=1";

    const result = xRayContextExtractor(baseInfo);
    expect(result).toEqual({
      traceId: "5759e988bd862e3fe1be46a994272793",
      parentSpanId: undefined,
      sampling: "SAMPLED",
    });
  });

  it("maps Sampled=0 to NOT_SAMPLED", () => {
    process.env._X_AMZN_TRACE_ID =
      "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=0";

    const result = xRayContextExtractor(baseInfo);
    expect(result?.sampling).toBe("NOT_SAMPLED");
  });

  it("maps a missing Sampled field to UNDECIDED", () => {
    process.env._X_AMZN_TRACE_ID =
      "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8";

    const result = xRayContextExtractor(baseInfo);
    expect(result?.sampling).toBe("UNDECIDED");
  });

  it("maps an unusable Sampled value to UNDECIDED", () => {
    process.env._X_AMZN_TRACE_ID =
      "Root=1-5759e988-bd862e3fe1be46a994272793;Sampled=?";

    const result = xRayContextExtractor(baseInfo);
    expect(result?.sampling).toBe("UNDECIDED");
  });

  it("returns undefined for an all-zero Root (well-formed but invalid)", () => {
    process.env._X_AMZN_TRACE_ID =
      "Root=1-00000000-000000000000000000000000;Parent=53995c3f42cd8ad8;Sampled=1";
    expect(xRayContextExtractor(baseInfo)).toBeUndefined();
  });

  it("treats an all-zero Parent as absent, keeping the valid Root", () => {
    process.env._X_AMZN_TRACE_ID =
      "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=0000000000000000;Sampled=1";

    const result = xRayContextExtractor(baseInfo);
    expect(result).toEqual({
      traceId: "5759e988bd862e3fe1be46a994272793",
      parentSpanId: undefined,
      sampling: "SAMPLED",
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
      sampling: "SAMPLED",
    });
  });

  it("ignores invalid Parent field (wrong length)", () => {
    process.env._X_AMZN_TRACE_ID =
      "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=short;Sampled=1";

    const result = xRayContextExtractor(baseInfo);
    expect(result).toEqual({
      traceId: "5759e988bd862e3fe1be46a994272793",
      parentSpanId: undefined,
      sampling: "SAMPLED",
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
      sampling: "SAMPLED",
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
    expect(result?.sampling).toBe("NOT_SAMPLED");
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

  it("returns undefined for traceparent with malformed flags (not 2 hex chars)", () => {
    const info = {
      ...baseInfo,
      context: {
        clientContext: {
          custom: {
            traceparent:
              "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-zz",
          },
        },
      },
    } as unknown as InvocationInfo;

    expect(w3cClientContextExtractor(info)).toBeUndefined();
  });

  it("returns undefined for an all-zero traceId (well-formed but invalid)", () => {
    // An all-zero trace ID is 32 hex chars but invalid per the W3C spec. It must
    // be rejected so its sampled bit is not treated as authoritative when the
    // resolver falls back to the ARN-derived trace.
    const info = {
      ...baseInfo,
      context: {
        clientContext: {
          custom: {
            traceparent:
              "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
          },
        },
      },
    } as unknown as InvocationInfo;

    expect(w3cClientContextExtractor(info)).toBeUndefined();
  });

  it("returns undefined for an all-zero parentId (well-formed but invalid)", () => {
    const info = {
      ...baseInfo,
      context: {
        clientContext: {
          custom: {
            traceparent:
              "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
          },
        },
      },
    } as unknown as InvocationInfo;

    expect(w3cClientContextExtractor(info)).toBeUndefined();
  });
});

const VALID_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const VALID_SPAN_ID = "00f067aa0ba902b7";
const ALL_ZERO_TRACE_ID = "0".repeat(32);
const ALL_ZERO_SPAN_ID = "0".repeat(16);

describe("resolveSampling", () => {
  it("prefers an explicit SAMPLED value over traceFlags", () => {
    expect(resolveSampling({ sampling: "SAMPLED", traceFlags: 0 })).toBe(
      "SAMPLED",
    );
  });

  it("prefers an explicit NOT_SAMPLED value over traceFlags", () => {
    expect(resolveSampling({ sampling: "NOT_SAMPLED", traceFlags: 1 })).toBe(
      "NOT_SAMPLED",
    );
  });

  it("returns an explicit UNDECIDED value as-is", () => {
    expect(resolveSampling({ sampling: "UNDECIDED", traceFlags: 1 })).toBe(
      "UNDECIDED",
    );
  });

  it("derives SAMPLED from the traceFlags sampled bit when sampling is absent", () => {
    expect(resolveSampling({ traceFlags: 1 })).toBe("SAMPLED");
  });

  it("derives NOT_SAMPLED from a clear traceFlags sampled bit", () => {
    expect(resolveSampling({ traceFlags: 0 })).toBe("NOT_SAMPLED");
  });

  it("reads only the low sampled bit of traceFlags", () => {
    // 0b10 has the sampled (low) bit clear.
    expect(resolveSampling({ traceFlags: 2 })).toBe("NOT_SAMPLED");
    // 0b11 has the sampled (low) bit set.
    expect(resolveSampling({ traceFlags: 3 })).toBe("SAMPLED");
  });

  it("returns UNDECIDED when neither sampling nor traceFlags is provided", () => {
    expect(resolveSampling({})).toBe("UNDECIDED");
  });
});

describe("hasCompleteRemoteParent", () => {
  it("is true for a context with valid trace and parent IDs", () => {
    expect(
      hasCompleteRemoteParent({
        traceId: VALID_TRACE_ID,
        parentSpanId: VALID_SPAN_ID,
      }),
    ).toBe(true);
  });

  it("is false when the context is undefined", () => {
    expect(hasCompleteRemoteParent(undefined)).toBe(false);
  });

  it("is false when the parent span ID is missing", () => {
    expect(
      hasCompleteRemoteParent({
        traceId: VALID_TRACE_ID,
      }),
    ).toBe(false);
  });

  it("is false for an all-zero (invalid) trace ID", () => {
    expect(
      hasCompleteRemoteParent({
        traceId: ALL_ZERO_TRACE_ID,
        parentSpanId: VALID_SPAN_ID,
      }),
    ).toBe(false);
  });

  it("is false for an all-zero (invalid) parent span ID", () => {
    expect(
      hasCompleteRemoteParent({
        traceId: VALID_TRACE_ID,
        parentSpanId: ALL_ZERO_SPAN_ID,
      }),
    ).toBe(false);
  });
});

describe("hasValidTraceId", () => {
  it("is true for a context with a valid trace ID", () => {
    expect(
      hasValidTraceId({
        traceId: VALID_TRACE_ID,
      }),
    ).toBe(true);
  });

  it("does not require a parent span ID", () => {
    expect(
      hasValidTraceId({
        traceId: VALID_TRACE_ID,
      }),
    ).toBe(true);
  });

  it("is false when the context is undefined", () => {
    expect(hasValidTraceId(undefined)).toBe(false);
  });

  it("is false for an all-zero (invalid) trace ID", () => {
    expect(
      hasValidTraceId({
        traceId: ALL_ZERO_TRACE_ID,
      }),
    ).toBe(false);
  });
});
