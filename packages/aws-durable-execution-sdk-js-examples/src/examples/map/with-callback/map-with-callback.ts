import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Map with Callback",
  description:
    "Demonstrates map operation where each iteration waits for an external callback",
};

interface ApprovalItem {
  id: number;
  name: string;
}

/**
 * Each map iteration:
 * 1. Runs a step to prepare the item
 * 2. Waits for an external callback (e.g., human approval)
 * 3. Runs a final step to process the approved result
 */
export const handler = withDurableExecution(
  async (event: { items?: ApprovalItem[] }, context: DurableContext) => {
    const items = event.items ?? [
      { id: 1, name: "order-alpha" },
      { id: 2, name: "order-beta" },
      { id: 3, name: "order-gamma" },
    ];

    const results = await context.map(
      "approval-pipeline",
      items,
      async (ctx: DurableContext, item: ApprovalItem, index: number) => {
        // Step 1: Prepare the item for approval
        const prepared = await ctx.step(`prepare-${item.name}`, async () => ({
          itemId: item.id,
          itemName: item.name,
          preparedAt: "2025-01-01T00:00:00Z",
        }));

        // Step 2: Wait for external approval callback
        const approval = await ctx.waitForCallback<string>(
          `approval-${item.name}`,
          async (callbackId: string) => {
            // In production, you'd send callbackId to an external system
            // e.g., sendApprovalEmail(item.name, callbackId)
          },
          { timeout: { seconds: 10 } },
        );

        // Step 3: Process the approved item
        const processed = await ctx.step(`process-${item.name}`, async () => ({
          ...prepared,
          approval,
          status: "completed",
        }));

        return processed;
      },
      { maxConcurrency: 3 },
    );

    return {
      totalProcessed: results.successCount,
      totalFailed: results.failureCount,
      completionReason: results.completionReason,
      items: results.getResults(),
    };
  },
);
