// The durable function that the llm end-to-end test deploys. It runs the five
// operations against the default text model, with a durable wait in the middle
// so the execution replays.
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { llm } from "@aws/durable-execution-sdk-js-extras/llm";

const model = llm();

export const handler = withDurableExecution(
  async (event: { body: string }, context: DurableContext) => {
    const urgent = await model.check(
      context,
      "Does the writer sound urgent?",
      event.body,
    );
    await context.wait("pause", { seconds: 2 });
    const team = await model.classify(
      context,
      "Which team should handle this?",
      ["billing", "sales", "retail"],
      event.body,
    );
    const topics = await model.label(
      context,
      "Which topics does the message mention?",
      ["payments", "shipping", "pricing", "security"],
      event.body,
    );
    const frustration = await model.score(
      context,
      "How frustrated is the writer?",
      ["calm", "annoyed", "furious"],
      event.body,
    );
    const summary = await model.ask(
      context,
      "Summarize the message in one short sentence.",
      event.body,
    );
    return { urgent, team, topics, frustration, summary };
  },
);
