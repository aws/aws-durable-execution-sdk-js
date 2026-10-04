import {
  CreateMicrovmAuthTokenCommand,
  GetMicrovmCommand,
  type LambdaMicrovmsClient,
  ResumeMicrovmCommand,
  RunMicrovmCommand,
  SuspendMicrovmCommand,
  TerminateMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";
import type {
  MicrovmConfig,
  MicrovmJobRequest,
  MicrovmRunHookPayload,
} from "..";

// The local test runner's execution ARN has no Region, so the operations read
// AWS_REGION. Tests that need it unset remove it themselves.
process.env.AWS_REGION ??= "us-east-1";

export interface SendOptions {
  abortSignal?: AbortSignal;
}

export type Handler = (
  input: unknown,
  options?: SendOptions,
) => Promise<unknown>;

/**
 * A call that never answers. It rejects only when its abort signal fires, as
 * the AWS SDK does. Without a signal, it waits forever.
 */
export const hangUntilAborted: Handler = (_input, options) =>
  new Promise((_resolve, reject) => {
    options?.abortSignal?.addEventListener("abort", () => {
      const error = new Error("Request aborted");
      error.name = "AbortError";
      reject(error);
    });
  });

/**
 * Records every command and answers from a per-command queue. When the queue
 * for a command is empty, the fake returns the command's success response.
 */
export class FakeMicrovmsClient {
  readonly runInputs: RunMicrovmCommand["input"][] = [];
  readonly terminateInputs: TerminateMicrovmCommand["input"][] = [];
  readonly tokenInputs: CreateMicrovmAuthTokenCommand["input"][] = [];
  runResponses: Handler[] = [];
  terminateResponses: Handler[] = [];
  getResponses: Handler[] = [];
  suspendResponses: Handler[] = [];
  resumeResponses: Handler[] = [];
  tokenResponses: Handler[] = [];
  /**
   * The MicroVM state that GetMicrovm reports when its queue is empty.
   * SuspendMicrovm sets it to SUSPENDED, and ResumeMicrovm to RUNNING.
   */
  microvmState = "RUNNING";
  /** Each lifecycle command in call order, such as "get:RUNNING" or "suspend". */
  readonly events: string[] = [];

  async send(command: unknown, options?: SendOptions): Promise<unknown> {
    if (command instanceof RunMicrovmCommand) {
      this.runInputs.push(command.input);
      const next = this.runResponses.shift();
      return next
        ? next(command.input)
        : {
            microvmId: "mvm-1",
            state: "PENDING",
            endpoint: "mvm-1.lambda-microvm.us-east-1.on.aws",
          };
    }
    if (command instanceof GetMicrovmCommand) {
      const next = this.getResponses.shift();
      const response = next
        ? await next(command.input, options)
        : {
            microvmId: "mvm-1",
            state: this.microvmState,
            endpoint: "mvm-1.lambda-microvm.us-east-1.on.aws",
          };
      this.events.push(`get:${(response as { state?: string }).state}`);
      return response;
    }
    if (command instanceof SuspendMicrovmCommand) {
      this.events.push("suspend");
      const next = this.suspendResponses.shift();
      if (next) {
        return next(command.input);
      }
      this.microvmState = "SUSPENDED";
      return {};
    }
    if (command instanceof ResumeMicrovmCommand) {
      this.events.push("resume");
      const next = this.resumeResponses.shift();
      if (next) {
        return next(command.input, options);
      }
      this.microvmState = "RUNNING";
      return {};
    }
    if (command instanceof CreateMicrovmAuthTokenCommand) {
      this.tokenInputs.push(command.input);
      const next = this.tokenResponses.shift();
      if (next) {
        return next(command.input, options);
      }
      return {
        authToken: { "X-aws-proxy-auth": `token-${this.tokenInputs.length}` },
      };
    }
    if (command instanceof TerminateMicrovmCommand) {
      this.events.push("terminate");
      this.terminateInputs.push(command.input);
      const next = this.terminateResponses.shift();
      return next ? next(command.input) : {};
    }
    throw new Error("unexpected command");
  }

  asClient(): LambdaMicrovmsClient {
    return this as unknown as LambdaMicrovmsClient;
  }

  payload(index = 0): MicrovmRunHookPayload<{ repo: string }> {
    return JSON.parse(this.runInputs[index].runHookPayload as string);
  }
}

export const baseConfig = (
  client: FakeMicrovmsClient,
  overrides: Partial<MicrovmConfig> = {},
): MicrovmConfig => ({
  imageIdentifier: "arn:aws:lambda:us-east-1:123456789012:microvm-image:ci",
  executionRoleArn: "arn:aws:iam::123456789012:role/microvm-role",
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

export interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: MicrovmJobRequest<unknown>;
}

/**
 * Answers each POST from a queue. A number is an HTTP status. An Error is a
 * connection failure. "hang" is a request that never answers: it rejects
 * only when its abort signal fires. An empty queue answers 202.
 */
export class FakeEndpoint {
  readonly requests: RecordedRequest[] = [];
  responses: (number | Error | "hang")[] = [];

  readonly fetch = (async (url: string, init: RequestInit) => {
    this.requests.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string),
    });
    const next = this.responses.shift() ?? 202;
    if (next === "hang") {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
      });
    }
    if (next instanceof Error) {
      throw next;
    }
    return new Response(null, { status: next });
  }) as unknown as typeof fetch;
}
