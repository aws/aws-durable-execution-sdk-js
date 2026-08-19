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
  const fallbackTraceId = "f".repeat(32);
  const fallbackSpanId = "e".repeat(16);

  beforeEach(() => {
    generator = new DeterministicIdGenerator({
      generateTraceId: jest.fn(() => fallbackTraceId),
      generateSpanId: jest.fn(() => fallbackSpanId),
    });
  });

  describe("generateTraceId", () => {
    it("returns the scoped trace ID", () => {
      const traceId = "abcdef1234567890abcdef1234567890";
      generator.withIds({ traceId }, () => {
        expect(generator.generateTraceId()).toBe(traceId);
      });
    });

    it("keeps the trace ID for the duration of the scope", () => {
      const traceId = "1234567890abcdef1234567890abcdef";
      generator.withIds({ traceId }, () => {
        expect(generator.generateTraceId()).toBe(traceId);
        expect(generator.generateTraceId()).toBe(traceId);
      });
    });

    it("delegates to the fallback outside the scope", () => {
      expect(generator.generateTraceId()).toBe(fallbackTraceId);

      generator.withIds({ traceId: "a".repeat(32) }, () => {
        expect(generator.generateTraceId()).toBe("a".repeat(32));
      });

      expect(generator.generateTraceId()).toBe(fallbackTraceId);
    });
  });

  describe("generateSpanId", () => {
    it("returns the scoped span ID on the next call", () => {
      const spanId = "abcdef1234567890";
      generator.withIds({ spanId }, () => {
        expect(generator.generateSpanId()).toBe(spanId);
      });
    });

    it("delegates to the fallback after the scoped span ID is consumed", () => {
      const spanId = "abcdef1234567890";
      generator.withIds({ spanId }, () => {
        expect(generator.generateSpanId()).toBe(spanId);
        expect(generator.generateSpanId()).toBe(fallbackSpanId);
      });
    });

    it("delegates to the fallback outside the scope", () => {
      expect(generator.generateSpanId()).toBe(fallbackSpanId);
    });
  });

  describe("scope isolation", () => {
    it("restores the fallback after an exception", () => {
      expect(() =>
        generator.withIds({ traceId: "a".repeat(32) }, () => {
          throw new Error("boom");
        }),
      ).toThrow("boom");

      expect(generator.generateTraceId()).toBe(fallbackTraceId);
    });

    it("shares the active override across generator instances", () => {
      const providerGenerator = new DeterministicIdGenerator({
        generateTraceId: () => fallbackTraceId,
        generateSpanId: () => fallbackSpanId,
      });

      generator.withIds(
        { traceId: "a".repeat(32), spanId: "1".repeat(16) },
        () => {
          expect(providerGenerator.generateTraceId()).toBe("a".repeat(32));
          expect(providerGenerator.generateSpanId()).toBe("1".repeat(16));
        },
      );
    });

    it("isolates concurrent async contexts", async () => {
      const firstTraceId = "a".repeat(32);
      const secondTraceId = "b".repeat(32);

      await Promise.all([
        generator.withIds({ traceId: firstTraceId }, async () => {
          await Promise.resolve();
          expect(generator.generateTraceId()).toBe(firstTraceId);
        }),
        generator.withIds({ traceId: secondTraceId }, async () => {
          await Promise.resolve();
          expect(generator.generateTraceId()).toBe(secondTraceId);
        }),
      ]);

      expect(generator.generateTraceId()).toBe(fallbackTraceId);
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
  const executionStart = new Date("2026-08-19T00:00:00.000Z");

  it("produces a 32-char lowercase hex string", () => {
    const arn =
      "arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST:exec-id";
    const result = deriveTraceIdFromArn(arn, executionStart);
    expect(result).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is deterministic for the same ARN and execution start time", () => {
    const arn =
      "arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST:exec-id";
    const result1 = deriveTraceIdFromArn(arn, executionStart);
    const result2 = deriveTraceIdFromArn(
      arn,
      new Date(executionStart.toISOString()),
    );
    expect(result1).toBe(result2);
  });

  it("produces different results for different ARNs", () => {
    const arn1 =
      "arn:aws:lambda:us-east-1:123456789012:function:func-a:$LATEST:exec-1";
    const arn2 =
      "arn:aws:lambda:us-east-1:123456789012:function:func-b:$LATEST:exec-2";
    const result1 = deriveTraceIdFromArn(arn1, executionStart);
    const result2 = deriveTraceIdFromArn(arn2, executionStart);
    expect(result1).not.toBe(result2);
  });

  it("produces different results for different execution start times", () => {
    const arn =
      "arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST:exec-id";
    const result1 = deriveTraceIdFromArn(arn, executionStart);
    const result2 = deriveTraceIdFromArn(
      arn,
      new Date("2026-08-19T00:00:01.000Z"),
    );
    expect(result1).not.toBe(result2);
  });

  it("retains deterministic ARN-only derivation when start time is unavailable", () => {
    const arn =
      "arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST:exec-id";
    expect(deriveTraceIdFromArn(arn)).toBe(deriveTraceIdFromArn(arn));
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
