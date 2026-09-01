// 11-1: Replay rejects an operation-type mismatch
import {
  DurableContext,
  DurableInstrumentationPlugin,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

const replayByRequestId = new Map<string, boolean>();

const replayIndicatorPlugin: DurableInstrumentationPlugin = {
  async onInvocationStart(info) {
    replayByRequestId.set(info.requestId, !info.isFirstInvocation);
  },
  async onInvocationEnd(info) {
    replayByRequestId.delete(info.requestId);
  },
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    context.configureLogger({ modeAware: false });

    const isReplaying = replayByRequestId.get(
      context.lambdaContext.awsRequestId,
    );
    if (isReplaying === undefined) {
      throw new Error("Replay indicator was not initialized");
    }

    if (isReplaying) {
      context.logger.info("DETERMINISM_REPLAY_CANARY");
      return await context.step("identity-slot", async (stepContext) => {
        stepContext.logger.info("DETERMINISM_STEP_BODY_EXECUTED");
        return "unexpected";
      });
    }

    await context.wait("identity-slot", { seconds: 1 });
    return null;
  },
  { plugins: [replayIndicatorPlugin] },
);
