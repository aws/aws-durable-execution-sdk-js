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
  readonly suspendInputs: SuspendMicrovmCommand["input"][] = [];
  runResponses: Handler[] = [];
  terminateResponses: Handler[] = [];
  getResponses: Handler[] = [];
  suspendResponses: Handler[] = [];
  tokenResponses: Handler[] = [];
  /**
   * The MicroVM state that GetMicrovm reports when its queue is empty.
   * SuspendMicrovm sets it to SUSPENDED.
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
      this.suspendInputs.push(command.input);
      const next = this.suspendResponses.shift();
      if (next) {
        return next(command.input, options);
      }
      this.microvmState = "SUSPENDED";
      return {};
    }
    if (command instanceof ResumeMicrovmCommand) {
      // The operations never resume a MicroVM. The service resumes it on
      // the next request. So a ResumeMicrovm call is a defect: the event
      // records it, and the call fails.
      this.events.push("resume");
      throw new Error("unexpected ResumeMicrovm call");
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

/**
 * An error with the shape of `STSServiceException` from the AWS SDK. A
 * credential provider that assumes a role calls STS inside `client.send`.
 * When that call fails, `client.send` rejects with this error. The AWS SDK
 * gives each service exception class a static `shapeId`, and `instanceof`
 * compares it. So this error is not an instance of
 * `LambdaMicrovmsServiceException`.
 */
export class FakeStsServiceException extends Error {
  static readonly shapeId =
    "smithy.ts.sdk.synthetic.com.amazonaws.sts#STSServiceException";
  readonly $fault = "client";

  constructor(
    message: string,
    readonly $metadata: Record<string, unknown> = {
      httpStatusCode: 403,
      requestId: "sts-req-1",
    },
    name = "AccessDenied",
  ) {
    super(message);
    this.name = name;
  }
}

/** The answer of the endpoint of a terminated or suspended MicroVM. */
export const connectFailed = (): Response =>
  new Response(null, {
    status: 502,
    headers: { "x-aws-proxy-error": "MICROVM_CONNECT_FAILED" },
  });

/**
 * Returns an endpoint that acts as the endpoint of a MicroVM launched with
 * `idlePolicy.autoResumeEnabled: true`. It records each request in the
 * client's event list as `request:<path>`. A queued answer is used first.
 * Otherwise it answers by the client's `microvmState`:
 *
 * - `TERMINATING` or `TERMINATED`: a 502 with `MICROVM_CONNECT_FAILED`.
 * - `SUSPENDING` or `SUSPENDED`: that 502 for the first `windowRequests`
 *   requests, as the real endpoint does for about 5 seconds after a
 *   suspend. The next request resumes the MicroVM: the endpoint records
 *   `auto-resume`, sets the state to `RUNNING`, and accepts the request.
 * - Any other state: it accepts the request.
 */
export function autoResumingEndpoint(
  client: FakeMicrovmsClient,
  windowRequests = 1,
): FakeEndpoint {
  const endpoint = new FakeEndpoint();
  const deliver = endpoint.fetch;
  let refused = 0;
  (endpoint as { fetch: typeof fetch }).fetch = (async (
    url: string,
    init: RequestInit,
  ) => {
    client.events.push(`request:${new URL(url).pathname}`);
    if (endpoint.responses.length === 0) {
      const state = client.microvmState;
      if (state === "TERMINATING" || state === "TERMINATED") {
        endpoint.responses.push(connectFailed());
      } else if (state === "SUSPENDING" || state === "SUSPENDED") {
        if (refused < windowRequests) {
          refused++;
          endpoint.responses.push(connectFailed());
        } else {
          refused = 0;
          client.microvmState = "RUNNING";
          client.events.push("auto-resume");
        }
      }
    }
    return deliver(url, init);
  }) as unknown as typeof fetch;
  return endpoint;
}

export interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: MicrovmJobRequest<unknown>;
  redirect: RequestInit["redirect"];
}

/**
 * Answers each POST from a queue. A number is an HTTP status. A Response is
 * returned as it is, for example a redirect with a `Location` header. An
 * Error is a connection failure. "hang" is a request that never answers: it
 * rejects only when its abort signal fires. An empty queue answers 202.
 */
export class FakeEndpoint {
  readonly requests: RecordedRequest[] = [];
  responses: (number | Response | Error | "hang")[] = [];

  readonly fetch = (async (url: string, init: RequestInit) => {
    this.requests.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string),
      redirect: init.redirect,
    });
    const next = this.responses.shift() ?? 202;
    if (next instanceof Response) {
      return next;
    }
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
