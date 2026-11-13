import { Readable } from "node:stream";
import {
  type BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
  StopRuntimeSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type { AgentcoreConfig, AgentcoreJobDocument } from "..";

// The operation reads the function's Region from AWS_REGION, which Lambda
// sets. Tests that need it unset remove it themselves.
process.env.AWS_REGION ??= "us-east-1";

export const RUNTIME_ARN =
  "arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/reviewer-abc123";

export type Handler = (
  input: unknown,
  options?: { abortSignal?: AbortSignal },
) => Promise<unknown>;

/** A stream that yields `chunks`, as the AWS SDK returns a body in Node.js. */
export const bodyOf = (...chunks: string[]): Readable =>
  Readable.from(chunks.map((chunk) => Buffer.from(chunk, "utf8")));

/** An InvokeAgentRuntime answer whose streamed body is `body`. */
export const answer =
  (body: string, statusCode = 200): Handler =>
  async () => ({
    statusCode,
    contentType: "application/json",
    response: bodyOf(body),
  });

/** A call that ends only when its abort signal fires. */
export const hangUntilAborted: Handler = (_input, options) =>
  new Promise((_, reject) => {
    options?.abortSignal?.addEventListener("abort", () =>
      reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );
  });

/**
 * Records every command and answers from a per-command queue. When the
 * queue for a command is empty, InvokeAgentRuntime answers
 * `{"accepted": true}` and StopRuntimeSession succeeds.
 */
export class FakeAgentcoreClient {
  readonly invokeInputs: InvokeAgentRuntimeCommand["input"][] = [];
  readonly stopInputs: StopRuntimeSessionCommand["input"][] = [];
  invokeResponses: Handler[] = [];
  stopResponses: Handler[] = [];
  /**
   * Called with each InvokeAgentRuntime input. A returned value replaces the
   * queued answer.
   */
  onInvoke:
    | ((input: InvokeAgentRuntimeCommand["input"]) => Promise<unknown>)
    | undefined;

  async send(
    command: unknown,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown> {
    if (command instanceof InvokeAgentRuntimeCommand) {
      this.invokeInputs.push(command.input);
      const forwarded = await this.onInvoke?.(command.input);
      if (forwarded !== undefined) {
        return forwarded;
      }
      const next = this.invokeResponses.shift() ?? answer('{"accepted":true}');
      return next(command.input, options);
    }
    if (command instanceof StopRuntimeSessionCommand) {
      this.stopInputs.push(command.input);
      const next = this.stopResponses.shift();
      return next ? next(command.input, options) : { statusCode: 200 };
    }
    throw new Error("unexpected command");
  }

  asClient(): BedrockAgentCoreClient {
    return this as unknown as BedrockAgentCoreClient;
  }

  /** The job document of one InvokeAgentRuntime call. */
  document(index = 0): AgentcoreJobDocument {
    return JSON.parse(
      Buffer.from(this.invokeInputs[index].payload as Uint8Array).toString(
        "utf8",
      ),
    );
  }
}

export const baseConfig = (
  client: FakeAgentcoreClient,
  overrides: Partial<AgentcoreConfig> = {},
): AgentcoreConfig => ({
  agentRuntimeArn: RUNTIME_ARN,
  timeout: { minutes: 30 },
  client: client.asClient(),
  ...overrides,
});

export const throwing =
  (error: Error): Handler =>
  async () => {
    throw error;
  };

export const metadata = { $metadata: {} };
