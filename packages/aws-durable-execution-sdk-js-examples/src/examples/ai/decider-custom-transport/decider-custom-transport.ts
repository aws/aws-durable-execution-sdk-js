import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  type DeciderTransport,
  decider,
} from "@aws/durable-execution-sdk-js-extras/ai";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Decider Custom Transport",
  description:
    "Triages a support ticket with decider() check, classify, label and score, through a custom transport",
};

/**
 * A transport is the function that sends one request to a decision model and
 * returns its JSON reply. A real deployment uses `sageMakerTransport`,
 * `lambdaTransport`, `agentCoreTransport`, or an `endpoint` instead.
 *
 * This one answers from keywords, in the reply format of a Strands Decider,
 * so the example runs without a deployed model.
 */
const keywordModel: DeciderTransport = async (request) => {
  const text = String(request.state).toLowerCase();
  const answers: Record<string, unknown> = {};
  for (const [key, question] of Object.entries(request.questions)) {
    const { type, criteria } = question as {
      type: string;
      criteria?: Record<string, unknown>;
    };
    if (type === "noul") {
      // `label` asks one yes-or-no question per label, and names the label
      // on the last line. `check` asks one question with no label.
      const { instructions } = question as { instructions: string };
      const label = /Does this label apply: (.+)$/.exec(instructions)?.[1];
      const words = label ? [label] : ["now", "urgent", "failing"];
      const yes = words.some((word) => text.includes(word.toLowerCase()));
      answers[key] = { type: "noul", noul: yes ? 0.9 : 0.1 };
    } else if (type === "score") {
      // The score is the position on the scale, from 0 to its last entry.
      const levels = criteria as unknown as string[];
      const angry = ["!", "again", "still"].filter((word) =>
        text.includes(word),
      ).length;
      answers[key] = {
        type: "score",
        score: Math.min(angry, levels.length - 1),
        probabilities: {},
      };
    } else if (type === "choice") {
      const options = Object.keys(criteria ?? {});
      const choice =
        options.find((option) => text.includes(option)) ?? options[0];
      answers[key] = { type: "choice", choice, probabilities: {} };
    }
  }
  return { model: "keyword-model", answers };
};

const decide = decider({ transport: keywordModel });

export const handler = withDurableExecution(
  async (event: { ticket: string }, context: DurableContext) => {
    // Each call is one durable step. A replay returns the checkpointed
    // answer and does not call the model again.
    const urgent = await decide.check(
      context,
      "Does the customer need help right away?",
      event.ticket,
    );
    const team = await decide.classify(
      context,
      "Which team should handle the ticket?",
      ["billing", "shipping", "other"],
      event.ticket,
    );
    const topics = await decide.label(
      context,
      "Which topics does the ticket mention?",
      ["refund", "invoice", "delivery"],
      event.ticket,
    );
    const frustration = await decide.score(
      context,
      "How frustrated is the customer?",
      ["calm", "annoyed", "angry"],
      event.ticket,
    );
    return { urgent, team, topics, frustration };
  },
);
