// 3-17: Child context with durable logger only (verify no re-execution on replay)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.runInChildContext(
      "print-child",
      async (childContext: DurableContext) => {
        // Replay logging: mode-aware suppression is disabled so an incorrect
        // second child execution would emit a second log and fail the count.
        childContext.configureLogger({ modeAware: false });
        childContext.logger.info(event);
        return event as string;
      },
    );

    await context.wait({ seconds: 1 });

    return result;
  },
);
