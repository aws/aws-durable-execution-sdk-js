import {
  DurableContext,
  StepError,
  withDurableExecution,
  retryPresets,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Step Error Determinism",
  description:
    "Tests that error handling behavior is deterministic between initial execution and replay",
};

class CustomBusinessError extends Error {
  readonly errorCode: string;

  constructor(message: string, errorCode: string) {
    super(message);
    this.name = "CustomBusinessError";
    this.errorCode = errorCode;
  }
}

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    let stepError: StepError | null = null;

    // Step throws custom error
    try {
      await context.step(
        "failing-step",
        async () => {
          throw new CustomBusinessError(
            "Business validation failed",
            "VALIDATION_ERROR",
          );
        },
        { retryStrategy: retryPresets.noRetry },
      );
    } catch (error) {
      stepError = error as StepError;
    }

    // Check error properties before replay
    const errorPropsBeforeReplay = await context.step(
      "check-before-replay",
      async () => {
        return {
          hasError: stepError !== null,
          errorMessage: stepError?.message,
          causeMessage: stepError?.cause?.message,
          causeName: stepError?.cause?.name,
          // Note: Custom properties like errorCode are lost during serialization
          // but error handling is now deterministic between runs
        };
      },
      { retryStrategy: retryPresets.noRetry },
    );

    await context.wait({ seconds: 1 });

    // Check error properties after replay
    const errorPropsAfterReplay = await context.step(
      "check-after-replay",
      async () => {
        return {
          hasError: stepError !== null,
          errorMessage: stepError?.message,
          causeMessage: stepError?.cause?.message,
          causeName: stepError?.cause?.name,
        };
      },
      { retryStrategy: retryPresets.noRetry },
    );

    // Verify deterministic behavior - error properties should be the same
    return (
      JSON.stringify(errorPropsBeforeReplay) ===
      JSON.stringify(errorPropsAfterReplay)
    );
  },
);
