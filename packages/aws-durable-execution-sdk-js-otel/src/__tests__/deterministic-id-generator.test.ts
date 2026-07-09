import {
  DeterministicIdGenerator,
  deriveTraceIdFromXRayRoot,
  deriveTraceIdFromArn,
  deriveSpanIdFromOperationId,
  deriveWorkflowSpanId,
} from "../deterministic-id-generator";
import * as fc from "fast-check";

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
  const TEST_ARN =
    "arn:aws:lambda:us-east-1:123456789012:function:test-func:test-exec-1";

  it("produces a 16-char lowercase hex string", () => {
    const operationId = "step-1-fetch-user";
    const result = deriveSpanIdFromOperationId(operationId, TEST_ARN);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic (same input always produces same output)", () => {
    const operationId = "step-1-fetch-user";
    const result1 = deriveSpanIdFromOperationId(operationId, TEST_ARN);
    const result2 = deriveSpanIdFromOperationId(operationId, TEST_ARN);
    expect(result1).toBe(result2);
  });

  it("produces different results for different operation IDs", () => {
    const result1 = deriveSpanIdFromOperationId("op-1", TEST_ARN);
    const result2 = deriveSpanIdFromOperationId("op-2", TEST_ARN);
    expect(result1).not.toBe(result2);
  });

  it("handles empty string", () => {
    const result = deriveSpanIdFromOperationId("", TEST_ARN);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it("produces different span IDs for different execution ARNs with the same operation ID", () => {
    const arn1 = "arn:aws:lambda:us-east-1:123456789012:function:func-a:exec-1";
    const arn2 = "arn:aws:lambda:us-east-1:123456789012:function:func-b:exec-2";
    const result1 = deriveSpanIdFromOperationId("op-1", arn1);
    const result2 = deriveSpanIdFromOperationId("op-1", arn2);
    expect(result1).not.toBe(result2);
  });
});

/**
 * Preservation Property Tests for deriveSpanIdFromOperationId
 *
 * These property-based tests capture the CORRECT behaviors that must be
 * preserved both before and after the span ID collision fix.
 *
 * A fixed execution ARN is passed as the second argument to be compatible
 * with both the current API (ignores extra arg) and future API (uses it).
 *
 * **Validates: Requirements 3.1, 3.2, 3.5**
 */
describe("deriveSpanIdFromOperationId - Preservation Properties", () => {
  const FIXED_EXECUTION_ARN =
    "arn:aws:lambda:us-east-1:123456789012:function:test-function:test-exec-1";

  it("Property: Idempotency - same inputs always produce the same span ID", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (operationId) => {
        const result1 = deriveSpanIdFromOperationId(
          operationId,
          FIXED_EXECUTION_ARN,
        );
        const result2 = deriveSpanIdFromOperationId(
          operationId,
          FIXED_EXECUTION_ARN,
        );
        expect(result1).toBe(result2);
      }),
    );
  });

  it("Property: Format validity - output always matches /^[0-9a-f]{16}$/", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (operationId) => {
        const result = deriveSpanIdFromOperationId(
          operationId,
          FIXED_EXECUTION_ARN,
        );
        expect(result).toMatch(/^[0-9a-f]{16}$/);
      }),
    );
  });

  it("Property: Uniqueness within execution - distinct operationIds produce distinct span IDs", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (opId1, opId2) => {
          fc.pre(opId1 !== opId2);
          const result1 = deriveSpanIdFromOperationId(
            opId1,
            FIXED_EXECUTION_ARN,
          );
          const result2 = deriveSpanIdFromOperationId(
            opId2,
            FIXED_EXECUTION_ARN,
          );
          expect(result1).not.toBe(result2);
        },
      ),
    );
  });
});

describe("Bug Condition Exploration - Property-Based Tests", () => {
  /**
   * **Validates: Requirements 1.1, 1.3**
   *
   * Property 1: Bug Condition - Different Executions Produce Distinct Span IDs
   *
   * This test encodes the EXPECTED behavior: when two different execution ARNs
   * call deriveSpanIdFromOperationId with the same operation ID, they should
   * receive DIFFERENT span IDs.
   *
   * On UNFIXED code, this test WILL FAIL because the current function signature
   * is deriveSpanIdFromOperationId(operationId: string) — it doesn't accept an
   * execution ARN parameter at all, so the second argument is simply ignored
   * and both calls produce the same result.
   *
   * EXPECTED TO FAIL — failure confirms the bug exists.
   */
  it("different execution ARNs with the same operation ID produce distinct span IDs", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (arn1, arn2, opId) => {
          fc.pre(arn1 !== arn2);

          const result1 = (deriveSpanIdFromOperationId as Function)(opId, arn1);
          const result2 = (deriveSpanIdFromOperationId as Function)(opId, arn2);

          expect(result1).not.toBe(result2);
        },
      ),
    );
  });
});

describe("deriveWorkflowSpanId", () => {
  const TEST_ARN =
    "arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST:exec-123";

  it("produces a 16-char lowercase hex string", () => {
    const result = deriveWorkflowSpanId(TEST_ARN);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic (same input always produces same output)", () => {
    const result1 = deriveWorkflowSpanId(TEST_ARN);
    const result2 = deriveWorkflowSpanId(TEST_ARN);
    expect(result1).toBe(result2);
  });

  it("produces different results for different ARNs", () => {
    const arn1 =
      "arn:aws:lambda:us-east-1:123456789012:function:func-a:$LATEST:exec-1";
    const arn2 =
      "arn:aws:lambda:us-east-1:123456789012:function:func-b:$LATEST:exec-2";
    const result1 = deriveWorkflowSpanId(arn1);
    const result2 = deriveWorkflowSpanId(arn2);
    expect(result1).not.toBe(result2);
  });

  it("throws an Error for an empty string", () => {
    expect(() => deriveWorkflowSpanId("")).toThrow(
      "Execution ARN must be non-empty",
    );
  });

  it("never returns all-zeros", () => {
    const result = deriveWorkflowSpanId(TEST_ARN);
    expect(result).not.toBe("0000000000000000");
  });

  it("produces a different result from deriveSpanIdFromOperationId for the same ARN input", () => {
    // The "workflow:" salt should differentiate it from deriveSpanIdFromOperationId
    const workflowSpanId = deriveWorkflowSpanId(TEST_ARN);
    const opSpanId = deriveSpanIdFromOperationId(TEST_ARN, TEST_ARN);
    expect(workflowSpanId).not.toBe(opSpanId);
  });
});
