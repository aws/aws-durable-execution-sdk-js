import type { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type {
  BedrockConverseClient,
  DeciderRequest,
  DeciderTransport,
} from "..";

type ConverseInput = ConverseCommand["input"];

/** A Converse reply whose text is the JSON form of `json`, or the string itself. */
export function converseReply(json: unknown, stopReason = "end_turn"): unknown {
  return {
    output: {
      message: {
        role: "assistant",
        content: [
          { text: typeof json === "string" ? json : JSON.stringify(json) },
        ],
      },
    },
    stopReason,
  };
}

/** Records every Converse request and answers from a queue. */
export class FakeBedrock implements BedrockConverseClient {
  readonly inputs: ConverseInput[] = [];
  readonly signals: (AbortSignal | undefined)[] = [];
  replies: (unknown | Error)[] = [];

  async send(
    command: unknown,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown> {
    this.inputs.push((command as ConverseCommand).input);
    this.signals.push(options?.abortSignal);
    const next = this.replies.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (next === undefined) {
      throw new Error("FakeBedrock has no reply queued");
    }
    return next;
  }
}

/** Records every decision model request and answers from a queue. */
export class FakeDecider {
  readonly requests: DeciderRequest[] = [];
  replies: (unknown | Error)[] = [];

  readonly transport: DeciderTransport = async (request) => {
    this.requests.push(request);
    const next = this.replies.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (next === undefined) {
      throw new Error("FakeDecider has no reply queued");
    }
    return next;
  };
}

export const noul = (probability: number) => ({
  type: "noul",
  noul: probability,
});

export const choice = (
  picked: string,
  probabilities: Record<string, number>,
  confidence: number,
) => ({ type: "choice", choice: picked, probabilities, confidence });

export const scoreAnswer = (score: number, confidence: number) => ({
  type: "score",
  score,
  legend: {},
  probabilities: {},
  confidence,
});

export const answers = (value: Record<string, unknown>) => ({
  model: "fake",
  answers: value,
  usage: { input_tokens: 1, output_tokens: 1 },
});

/** Records every InvokeAgentRuntime command and answers from a queue. */
export class FakeAgentCore {
  readonly inputs: Record<string, unknown>[] = [];
  readonly signals: (AbortSignal | undefined)[] = [];
  replies: ({ body: string; statusCode?: number } | Error)[] = [];

  async send(
    command: unknown,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown> {
    this.inputs.push((command as { input: Record<string, unknown> }).input);
    this.signals.push(options?.abortSignal);
    const next = this.replies.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (next === undefined) {
      throw new Error("FakeAgentCore has no reply queued");
    }
    return {
      contentType: "application/json",
      statusCode: next.statusCode ?? 200,
      response: { transformToString: async () => next.body },
    };
  }

  /** The JSON request in the payload of call `i`. */
  request(i: number): unknown {
    return JSON.parse(
      new TextDecoder().decode(this.inputs[i].payload as Uint8Array),
    );
  }
}
