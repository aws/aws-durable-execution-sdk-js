// 7-11: Wait-for-callback with structured (JSON) result deserialization
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

interface ApprovalResult {
  status: string;
}

const jsonSerdes = {
  deserialize: async (
    str: string | undefined,
  ): Promise<ApprovalResult | undefined> => {
    if (str === undefined) return undefined;
    return JSON.parse(str) as ApprovalResult;
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.waitForCallback<ApprovalResult>(
      event,
      async (callbackId) => {
        // Submitter completes.
      },
      {
        serdes: jsonSerdes,
      },
    );
    return result.status;
  },
);
