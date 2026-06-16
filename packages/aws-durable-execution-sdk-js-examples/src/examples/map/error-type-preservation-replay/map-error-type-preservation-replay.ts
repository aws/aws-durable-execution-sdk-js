import {
  DurableContext,
  withDurableExecution,
  CallbackError,
  retryPresets,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Map Error Type Preservation Across Replay",
  description:
    "Verifies that map results with errors preserve the original error type " +
    "and cause chain after going through the child context ser/des round-trip and replay.",
};

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const items = [
      { id: 1, shouldFail: false },
      { id: 2, shouldFail: true },
      { id: 3, shouldFail: false },
    ];

    const results = await context.map(
      "map-with-errors",
      items,
      async (childContext, item, index) => {
        return await childContext.step(
          `process-item-${index}`,
          async () => {
            if (item.shouldFail) {
              throw new CallbackError(
                `Custom callback error for item ${item.id}`,
              );
            }
            return `Processed item ${item.id}`;
          },
          { retryStrategy: retryPresets.noRetry },
        );
      },
      {
        completionConfig: {
          toleratedFailureCount: 3,
        },
      },
    );

    // Capture error info BEFORE the wait — this is what map returned on first run.
    const errors = results.getErrors();
    const errorInfo = errors.map((error) => ({
      wrapperType: (error as any).errorType,
      wrapperMessage: error.message,
      causeType: (error.cause as any)?.errorType,
      causeMessage: error.cause?.message,
    }));

    const capturedBeforeReplay = await context.step(
      "capture-errors",
      async () => ({
        errorInfo,
        successCount: results.successCount,
        failureCount: results.failureCount,
      }),
    );

    // Wait forces a replay — on the next invocation, the map result
    // comes from the child context checkpoint (deserialized).
    await context.wait("force-replay", { seconds: 1 });

    // After replay, access the map result again.
    // The error cause chain should be preserved through the round-trip.
    const errorsAfterReplay = results.getErrors();
    const errorInfoAfterReplay = errorsAfterReplay.map((error) => ({
      wrapperType: (error as any).errorType,
      wrapperMessage: error.message,
      causeType: (error.cause as any)?.errorType,
      causeMessage: error.cause?.message,
    }));

    return {
      beforeReplay: capturedBeforeReplay,
      afterReplay: {
        errorInfo: errorInfoAfterReplay,
        successCount: results.successCount,
        failureCount: results.failureCount,
      },
    };
  },
);
