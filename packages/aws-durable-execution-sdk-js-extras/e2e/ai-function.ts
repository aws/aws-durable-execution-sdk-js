// The durable function that the ai end-to-end test deploys. It runs llm().ask
// against the default Bedrock model, with a durable wait in the middle so the
// execution replays. It has no decision model, so it also records that
// decider() throws without an endpoint.
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { decider, llm } from "@aws/durable-execution-sdk-js-extras/ai";

const model = llm();

function deciderError(): string | undefined {
  try {
    decider();
    return undefined;
  } catch (error) {
    return (error as Error).name;
  }
}

export const handler = withDurableExecution(
  async (event: { body: string }, context: DurableContext) => {
    const summary = await model.ask(
      context,
      "Summarize the message in one short sentence.",
      event.body,
    );
    await context.wait("pause", { seconds: 2 });
    const team = await model.ask(
      context,
      "Which team should handle this: billing, sales, or retail? Answer with one word.",
      event.body,
      { name: "llm.ask.team" },
    );
    return { deciderError: deciderError(), summary, team };
  },
);
