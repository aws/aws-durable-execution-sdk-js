import { createTestDurableContext } from "../../testing/create-test-durable-context";
import { CallbackError } from "../../errors/durable-error/durable-error";
import { createBatchResultSerdes } from "./batch-result";

/**
 * Composed tests for map/parallel error type preservation through
 * the createBatchResultSerdes serialize/deserialize round-trip.
 *
 * Verifies that error cause chains (type + message) survive the
 * serialization round-trip that occurs when the child context result
 * is checkpointed and later deserialized on replay.
 */
describe("map/parallel error type preservation through serdes", () => {
  it("should preserve error cause type and message through map result serialization round-trip", async () => {
    const { context } = createTestDurableContext();

    const items = [
      { id: 1, shouldFail: false },
      { id: 2, shouldFail: true },
      { id: 3, shouldFail: false },
    ];

    const result = await context.map(
      "map-with-errors",
      items,
      async (childContext, item) => {
        return await childContext.step(
          `process-${item.id}`,
          async () => {
            if (item.shouldFail) {
              throw new CallbackError(
                `Custom callback error for item ${item.id}`,
              );
            }
            return `Processed item ${item.id}`;
          },
          { retryStrategy: () => ({ shouldRetry: false }) },
        );
      },
      {
        completionConfig: { toleratedFailureCount: 3 },
      },
    );

    // Verify the result structure
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(1);

    // Get the error from the failed item
    const errors = result.getErrors();
    expect(errors).toHaveLength(1);

    const error = errors[0];
    expect((error as any).errorType).toBe("ChildContextError");
    expect((error.cause as any)?.errorType).toBe("CallbackError");
    expect(error.cause?.message).toBe("Custom callback error for item 2");

    // Now simulate what happens on replay: serialize then deserialize the BatchResult
    const serdes = createBatchResultSerdes<string>();
    const serialized = await serdes.serialize(result, {
      entityId: "test",
      durableExecutionArn: "arn:test",
    });
    const deserialized = await serdes.deserialize(serialized, {
      entityId: "test",
      durableExecutionArn: "arn:test",
    });

    // After deserialization, error types must be preserved
    const deserializedErrors = deserialized!.getErrors();
    expect(deserializedErrors).toHaveLength(1);

    const deserializedError = deserializedErrors[0];
    expect((deserializedError as any).errorType).toBe("ChildContextError");
    expect((deserializedError.cause as any)?.errorType).toBe("CallbackError");
    expect(deserializedError.cause?.message).toBe(
      "Custom callback error for item 2",
    );
  });

  it("should preserve error cause type and message through parallel result serialization round-trip", async () => {
    const { context } = createTestDurableContext();

    const result = await context.parallel(
      "parallel-with-errors",
      [
        async (childContext) => {
          return await childContext.step("success-branch", async () => {
            return "branch completed";
          });
        },
        async (childContext) => {
          return await childContext.step(
            "failing-branch",
            async () => {
              throw new CallbackError("Custom callback error from parallel");
            },
            { retryStrategy: () => ({ shouldRetry: false }) },
          );
        },
      ],
      {
        completionConfig: { toleratedFailureCount: 1 },
      },
    );

    // Verify the result structure
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);

    const errors = result.getErrors();
    expect(errors).toHaveLength(1);

    const error = errors[0];
    expect((error as any).errorType).toBe("ChildContextError");
    expect((error.cause as any)?.errorType).toBe("CallbackError");
    expect(error.cause?.message).toBe("Custom callback error from parallel");

    // Simulate replay: serialize then deserialize
    const serdes = createBatchResultSerdes<string>();
    const serialized = await serdes.serialize(result, {
      entityId: "test",
      durableExecutionArn: "arn:test",
    });
    const deserialized = await serdes.deserialize(serialized, {
      entityId: "test",
      durableExecutionArn: "arn:test",
    });

    // After deserialization, error types must be preserved
    const deserializedErrors = deserialized!.getErrors();
    expect(deserializedErrors).toHaveLength(1);

    const deserializedError = deserializedErrors[0];
    expect((deserializedError as any).errorType).toBe("ChildContextError");
    expect((deserializedError.cause as any)?.errorType).toBe("CallbackError");
    expect(deserializedError.cause?.message).toBe(
      "Custom callback error from parallel",
    );
  });
});
