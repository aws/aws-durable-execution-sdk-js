// The durable function that the llm end-to-end test deploys. It has no
// decision model, so it runs ask against the default Bedrock text model, with a
// durable wait in the middle so the execution replays. It also records that
// check rejects without a decision model.
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { llm } from "@aws/durable-execution-sdk-js-extras/llm";

const model = llm();

export const handler = withDurableExecution(
  async (event: { body: string }, context: DurableContext) => {
    const checkError = await model
      .check(context, "Does the writer sound urgent?", event.body)
      .then(
        () => undefined,
        (error: unknown) => (error as Error).name,
      );
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
    return { checkError, summary, team };
  },
);
