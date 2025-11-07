import {
  DurableContext,
  StepError,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "Error Determinism",
  description:
    "Demonstrates deterministic error handling behavior between initial execution and replay",
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
      await context.step("failing-step", async () => {
        throw new CustomBusinessError(
          "Business validation failed",
          "VALIDATION_ERROR",
        );
      });
    } catch (error) {
      stepError = error as StepError;
    }

    // Check error properties before replay
    const errorPropsBeforeReplay = await context.step(
      "check-before-replay",
      async () => {
        return {
          isStepError: stepError instanceof StepError,
          message: stepError?.message,
          causeName: stepError?.cause?.name,
          causeMessage: stepError?.cause?.message,
          // Note: Custom properties like errorCode are lost during serialization
          // but error handling is now deterministic between runs
        };
      },
    );

    // Force replay by waiting
    await context.wait({ seconds: 1 });

    // Check error properties after replay
    const errorPropsAfterReplay = await context.step(
      "check-after-replay",
      async () => {
        return {
          isStepError: stepError instanceof StepError,
          message: stepError?.message,
          causeName: stepError?.cause?.name,
          causeMessage: stepError?.cause?.message,
        };
      },
    );

    // Verify deterministic behavior
    const isDeterministic = await context.step(
      "verify-determinism",
      async () => {
        return (
          JSON.stringify(errorPropsBeforeReplay) ===
          JSON.stringify(errorPropsAfterReplay)
        );
      },
    );

    return {
      isDeterministic,
      errorPropsBeforeReplay,
      errorPropsAfterReplay,
    };
  },
);
