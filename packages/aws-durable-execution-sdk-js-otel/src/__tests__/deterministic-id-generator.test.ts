import {
  DeterministicIdGenerator,
  deriveTraceIdFromXRayRoot,
  deriveTraceIdFromArn,
  deriveSpanIdFromOperationId,
} from "../deterministic-id-generator";

describe("DeterministicIdGenerator", () => {
  let generator: DeterministicIdGenerator;

  beforeEach(() => {
    generator = new DeterministicIdGenerator();
  });

  describe("generateTraceId", () => {
    it("returns setTraceId value when set", () => {
      const traceId = "abcdef1234567890abcdef1234567890";
      generator.setTraceId(traceId);
      expect(generator.generateTraceId()).toBe(traceId);
    });

    it("persists setTraceId across multiple calls", () => {
      const traceId = "1234567890abcdef1234567890abcdef";
      generator.setTraceId(traceId);
      expect(generator.generateTraceId()).toBe(traceId);
      expect(generator.generateTraceId()).toBe(traceId);
      expect(generator.generateTraceId()).toBe(traceId);
    });

    it("changes when setTraceId is called again", () => {
      const traceId1 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1";
      const traceId2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      generator.setTraceId(traceId1);
      expect(generator.generateTraceId()).toBe(traceId1);
      generator.setTraceId(traceId2);
      expect(generator.generateTraceId()).toBe(traceId2);
    });

    it("returns a 32-char hex string as fallback when no traceId is set", () => {
      const traceId = generator.generateTraceId();
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe("generateSpanId", () => {
    it("returns setNextSpanId value on the next call (one-shot)", () => {
      const spanId = "abcdef1234567890";
      generator.setNextSpanId(spanId);
      expect(generator.generateSpanId()).toBe(spanId);
    });

    it("reverts to default after one-shot is consumed", () => {
      const spanId = "abcdef1234567890";
      generator.setNextSpanId(spanId);
      expect(generator.generateSpanId()).toBe(spanId);
      // Next call should NOT return the same value
      const nextSpanId = generator.generateSpanId();
      expect(nextSpanId).not.toBe(spanId);
      expect(nextSpanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it("returns a 16-char hex string as fallback when no spanId is set", () => {
      const spanId = generator.generateSpanId();
      expect(spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it("supports multiple sequential one-shot overrides", () => {
      const spanId1 = "1111111111111111";
      const spanId2 = "2222222222222222";

      generator.setNextSpanId(spanId1);
      expect(generator.generateSpanId()).toBe(spanId1);

      generator.setNextSpanId(spanId2);
      expect(generator.generateSpanId()).toBe(spanId2);
    });
  });
});

describe("deriveTraceIdFromXRayRoot", () => {
  it("derives trace ID from a valid X-Ray Root field with Root= prefix", () => {
    const root = "Root=1-5759e988-bd862e3fe1be46a994272793";
    const result = deriveTraceIdFromXRayRoot(root);
    expect(result).toBe("5759e988bd862e3fe1be46a994272793");
  });

  it("derives trace ID from a valid X-Ray Root field without Root= prefix", () => {
    const root = "1-5759e988-bd862e3fe1be46a994272793";
    const result = deriveTraceIdFromXRayRoot(root);
    expect(result).toBe("5759e988bd862e3fe1be46a994272793");
  });

  it("returns undefined for invalid root (no 1- prefix after Root=)", () => {
    const root = "Root=2-5759e988-bd862e3fe1be46a994272793";
    const result = deriveTraceIdFromXRayRoot(root);
    expect(result).toBeUndefined();
  });

  it("returns undefined for root with wrong hex length", () => {
    const root = "Root=1-5759e988-bd862e3fe1be46a9";
    const result = deriveTraceIdFromXRayRoot(root);
    expect(result).toBeUndefined();
  });

  it("returns undefined for root with non-hex characters", () => {
    const root = "Root=1-5759e988-ZZZZZZZZZZZZZZZZZZZZZZZZ";
    const result = deriveTraceIdFromXRayRoot(root);
    expect(result).toBeUndefined();
  });

  it("handles another valid root", () => {
    const root = "Root=1-67890abc-def01234567890abcdef0123";
    const result = deriveTraceIdFromXRayRoot(root);
    expect(result).toBe("67890abcdef01234567890abcdef0123");
  });
});

describe("deriveTraceIdFromArn", () => {
  it("produces a 32-char lowercase hex string", () => {
    const arn =
      "arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST:exec-id";
    const result = deriveTraceIdFromArn(arn);
    expect(result).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is deterministic (same input always produces same output)", () => {
    const arn =
      "arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST:exec-id";
    const result1 = deriveTraceIdFromArn(arn);
    const result2 = deriveTraceIdFromArn(arn);
    expect(result1).toBe(result2);
  });

  it("produces different results for different ARNs", () => {
    const arn1 =
      "arn:aws:lambda:us-east-1:123456789012:function:func-a:$LATEST:exec-1";
    const arn2 =
      "arn:aws:lambda:us-east-1:123456789012:function:func-b:$LATEST:exec-2";
    const result1 = deriveTraceIdFromArn(arn1);
    const result2 = deriveTraceIdFromArn(arn2);
    expect(result1).not.toBe(result2);
  });
});

describe("deriveSpanIdFromOperationId", () => {
  it("produces a 16-char lowercase hex string", () => {
    const operationId = "step-1-fetch-user";
    const result = deriveSpanIdFromOperationId(operationId);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic (same input always produces same output)", () => {
    const operationId = "step-1-fetch-user";
    const result1 = deriveSpanIdFromOperationId(operationId);
    const result2 = deriveSpanIdFromOperationId(operationId);
    expect(result1).toBe(result2);
  });

  it("produces different results for different operation IDs", () => {
    const result1 = deriveSpanIdFromOperationId("op-1");
    const result2 = deriveSpanIdFromOperationId("op-2");
    expect(result1).not.toBe(result2);
  });

  it("handles empty string", () => {
    const result = deriveSpanIdFromOperationId("");
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });
});
