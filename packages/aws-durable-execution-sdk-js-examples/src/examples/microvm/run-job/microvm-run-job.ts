import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { microvm } from "@aws/durable-execution-sdk-js-extras/microvm";
import { ExampleConfig } from "../../../types";
import { requireMicrovmEnv } from "../../shared/microvm-env";

export const config: ExampleConfig = {
  name: "MicroVM Run Job",
  description:
    "Runs one job in a Lambda MicroVM and returns the result that the MicroVM reports",
  durableConfig: {
    ExecutionTimeout: 900,
    RetentionPeriodInDays: 7,
  },
  usesMicrovm: true,
};

export interface WordCount {
  wordCount: number;
  sha256: string;
  microvmId: string;
}

export const handler = withDurableExecution(
  async (event: { text: string }, context: DurableContext) => {
    const { imageArn, executionRoleArn } = requireMicrovmEnv();

    // The operation launches a MicroVM from the image and waits on a durable
    // callback. The input is small, so it goes in the MicroVM's run hook. The
    // worker in the MicroVM runs the job and completes the callback. The
    // operation then terminates the MicroVM.
    return microvm<WordCount>(
      context,
      "count-words",
      { text: event.text },
      {
        imageIdentifier: imageArn,
        executionRoleArn,
        timeout: { minutes: 5 },
        // A MicroVM that fails to boot fails the operation after this time,
        // instead of after the timeout.
        heartbeatTimeout: { seconds: 60 },
      },
    );
  },
);
