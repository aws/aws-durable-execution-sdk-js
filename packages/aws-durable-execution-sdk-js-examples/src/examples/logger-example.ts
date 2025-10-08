/**
 * Example demonstrating logger usage in DurableContext
 *
 * This example shows:
 * 1. How to access the logger from DurableContext
 * 2. How child contexts inherit the parent's logger
 * 3. How step contexts get enriched loggers
 * 4. Logger only logs in ExecutionMode (not during replay)
 * 5. Context logger enrichment with execution ARN and step ID
 *
 * Logger Enrichment:
 * - Top-level DurableContext: Enriched with execution_arn (no step_id)
 * - Child context: Enriched with execution_arn, step_id="<child-id>"
 * - Step context: Enriched with execution_arn, step_id="<step-id>", attempt
 *
 * Note: The DurableContext logger automatically checks the execution mode
 * and only logs when in ExecutionMode. During replay (ReplayMode or
 * ReplaySucceededContext), logging is suppressed to avoid duplicate logs.
 */

import { DurableContext } from "@aws/durable-execution-sdk-js";

export async function loggerExample(
  event: any,
  context: DurableContext,
): Promise<string> {
  // Top-level context logger: no step_id field
  context.logger.info("Starting workflow", { eventId: event.id });
  // Logs: { execution_arn: "...", level: "info", message: "Starting workflow", data: { eventId: ... }, timestamp: "..." }

  // Logger in steps - gets enriched with step ID and attempt number
  const result1 = await context.step("process-data", async (stepCtx) => {
    // Step context has an enriched logger with step ID and attempt number
    stepCtx.logger.info("Processing data in step");
    // Logs: { execution_arn: "...", step_id: "1", attempt: 0, level: "info", message: "Processing data in step", timestamp: "..." }
    return "processed";
  });

  context.logger.info("Step 1 completed", { result: result1 });

  // Child contexts inherit the parent's logger and have their own step ID
  const result2 = await context.runInChildContext(
    "child-workflow",
    async (childCtx) => {
      // Child context logger has step_id populated with child context ID
      childCtx.logger.info("Running in child context");
      // Logs: { execution_arn: "...", step_id: "2", level: "info", message: "Running in child context", timestamp: "..." }

      const childResult = await childCtx.step("child-step", async (stepCtx) => {
        // Step in child context has nested step ID
        stepCtx.logger.info("Processing in child step");
        // Logs: { execution_arn: "...", step_id: "2-1", attempt: 0, level: "info", message: "Processing in child step", timestamp: "..." }
        return "child-processed";
      });

      childCtx.logger.info("Child workflow completed", {
        result: childResult,
      });

      return childResult;
    },
  );

  context.logger.info("Workflow completed", {
    result1,
    result2,
  });

  return `${result1}-${result2}`;
}
