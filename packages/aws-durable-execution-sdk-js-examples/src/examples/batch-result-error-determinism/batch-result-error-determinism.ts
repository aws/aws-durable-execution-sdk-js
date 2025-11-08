import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

class CustomError extends Error {
  additionalProperty = 1;
}

export const config: ExampleConfig = {
  name: "Batch Result Error Determinism",
  description: "Testing error determinism in BatchResult from map operations",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const items = ["abc"];
    const result = await context.map("test", items, async (context) => {
      throw new CustomError("My error");
    });

    const error0 = result.failed()[0].error;

    console.log("Initial error:", error0);
    console.log("Error constructor name:", error0?.constructor.name);
    console.log("Error errorType property:", (error0 as any)?.errorType);
    console.log("Error cause:", error0?.cause);
    console.log("Cause constructor name:", error0?.cause?.constructor?.name);
    console.log(
      "Additional property:",
      (error0?.cause as any)?.additionalProperty,
    );

    await context.wait({ seconds: 1 });

    const error0AfterReplay = result.failed()[0].error;

    console.log("After replay error:", error0AfterReplay);
    console.log("Error constructor name:", error0AfterReplay?.constructor.name);
    console.log(
      "Error errorType property:",
      (error0AfterReplay as any)?.errorType,
    );
    console.log("Error cause:", error0AfterReplay?.cause);
    console.log(
      "Cause constructor name:",
      error0AfterReplay?.cause?.constructor?.name,
    );
    console.log(
      "Additional property:",
      (error0AfterReplay?.cause as any)?.additionalProperty,
    );

    // Check if error types are consistent
    const initialCauseIsCustomError = error0?.cause instanceof CustomError;
    const replayCauseIsCustomError =
      error0AfterReplay?.cause instanceof CustomError;

    return {
      initialCauseIsCustomError,
      replayCauseIsCustomError,
      areEqual: initialCauseIsCustomError === replayCauseIsCustomError,
    };
  },
);
