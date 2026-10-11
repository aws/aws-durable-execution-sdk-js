// Runs the request step against the real worker listener. The suspend
// protocol spans both packages:
//
// 1. The worker answers 503 from the moment it starts to suspend.
// 2. A suspended MicroVM's endpoint answers 502.
// 3. The request step answers a 502, 503, or 504 by checking the MicroVM
//    state, resuming it, and sending the job again.
// 4. The worker stops refusing jobs at the `resume` hook, or 30 seconds after
//    its suspend call.
//
// The other tests check each side against scripted answers. These tests
// connect the two sides. The fakes stand in for the MicroVMs service and the
// endpoint only.
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { DurableContext } from "@aws/durable-execution-sdk-js";
import {
  createMicrovmWorkerListener,
  HOOK_PATH_PREFIX,
  type MicrovmWorkerListener,
} from "@aws/durable-execution-sdk-js-microvm-worker";
import {
  CreateMicrovmAuthTokenCommand,
  GetMicrovmCommand,
  type LambdaMicrovmsClient,
  ResumeMicrovmCommand,
  SuspendMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";
import { defaultMicrovmRetryStrategy } from "..";
import {
  deliverJob,
  jobDocument,
  type LaunchResult,
  type OperationScope,
} from "../shared";

const IDLE_SECONDS = 10;
const ENDPOINT = "mvm-1.example";
const REGION = "us-east-1";

/**
 * The MicroVMs service for one MicroVM. Both sides use it: the worker calls
 * SuspendMicrovm, and the request step calls GetMicrovm and ResumeMicrovm.
 */
class FakeService {
  state = "RUNNING";
  /** While true, a SuspendMicrovm call stays pending until `finishSuspend`. */
  holdSuspend = false;
  /** Whether ResumeMicrovm sends the worker the `resume` hook. */
  sendResumeHook = true;
  readonly calls: string[] = [];
  listener: MicrovmWorkerListener | undefined;
  private pendingSuspend: (() => void) | undefined;

  async send(command: unknown): Promise<unknown> {
    if (command instanceof SuspendMicrovmCommand) {
      this.calls.push("suspend");
      if (this.holdSuspend) {
        // The service has not started the suspend yet. So the state stays
        // RUNNING, and the endpoint still reaches the worker.
        await new Promise<void>((resolve) => {
          this.pendingSuspend = resolve;
        });
      }
      this.state = "SUSPENDED";
      return {};
    }
    if (command instanceof GetMicrovmCommand) {
      this.calls.push(`get:${this.state}`);
      return { microvmId: "mvm-1", state: this.state, endpoint: ENDPOINT };
    }
    if (command instanceof ResumeMicrovmCommand) {
      this.calls.push("resume");
      this.state = "RUNNING";
      if (this.sendResumeHook && this.listener) {
        await send(
          this.listener,
          `${HOOK_PATH_PREFIX}resume`,
          {},
          LAMBDA_HOOK_HEADERS,
        );
      }
      return {};
    }
    if (command instanceof CreateMicrovmAuthTokenCommand) {
      return { authToken: { "X-aws-proxy-auth": "token" } };
    }
    throw new Error("unexpected command");
  }

  /** Lets a held SuspendMicrovm call finish. */
  finishSuspend(): void {
    this.pendingSuspend?.();
    this.pendingSuspend = undefined;
  }

  asClient(): LambdaMicrovmsClient {
    return this as unknown as LambdaMicrovmsClient;
  }
}

/**
 * The headers of Lambda's own hook calls, as measured in us-east-1. The
 * worker acts on the `resume` hook only for a local Host without a request ID.
 */
const LAMBDA_HOOK_HEADERS = { host: "localhost:8080" };

/**
 * Sends one request straight to the listener, and resolves with the status.
 * A job request comes through the endpoint, so it carries no Lambda hook
 * headers by default.
 */
function send(
  listener: MicrovmWorkerListener,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<number> {
  return new Promise((resolve) => {
    const request = Object.assign(
      Readable.from([
        Buffer.from(typeof body === "string" ? body : JSON.stringify(body)),
      ]),
      { url: path, method: "POST", headers },
    );
    let status = 0;
    const response = {
      headersSent: false,
      writeHead(code: number) {
        status = code;
        this.headersSent = true;
        return this;
      },
      end() {
        resolve(status);
        return this;
      },
    };
    listener.listener(
      request as unknown as IncomingMessage,
      response as unknown as ServerResponse,
    );
  });
}

describe("the request step against the real worker listener", () => {
  let service: FakeService;
  let listener: MicrovmWorkerListener;
  let ran: string[];
  let completions: string[];
  /** The status of each job request, or "lost" for a lost response. */
  let statuses: (number | string)[];
  /** When set, the endpoint delivers the next job request and loses its answer. */
  let loseNextAnswer: boolean;

  beforeEach(() => {
    // The listener reads request bodies with nextTick and microtasks, which
    // stay real. Date.now and every timer are fake, on both sides.
    jest.useFakeTimers({
      doNotFake: ["nextTick", "queueMicrotask", "setImmediate"],
    });
    service = new FakeService();
    ran = [];
    completions = [];
    statuses = [];
    loseNextAnswer = false;
    const lambda = {
      send: async (command: { constructor: { name: string } }) => {
        completions.push(command.constructor.name);
        return {};
      },
    } as unknown as ReturnType<
      NonNullable<
        Parameters<typeof createMicrovmWorkerListener>[0]["createClient"]
      >
    >;
    listener = createMicrovmWorkerListener({
      handler: async (input, context) => {
        ran.push(`${context.callbackId}:${JSON.stringify(input)}`);
        return "done";
      },
      createClient: () => lambda,
      createMicrovmsClient: () => service.asClient(),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    service.listener = listener;
  });

  afterEach(async () => {
    listener.close();
    service.finishSuspend();
    await jest.runOnlyPendingTimersAsync();
    await listener.idle();
    jest.useRealTimers();
  });

  /** The endpoint: a suspended MicroVM answers 502, a running one forwards. */
  const endpointFetch = (async (url: string, init: RequestInit) => {
    if (service.state !== "RUNNING") {
      statuses.push(502);
      return new Response(null, { status: 502 });
    }
    const status = await send(
      listener,
      new URL(url).pathname,
      init.body as string,
    );
    if (loseNextAnswer) {
      loseNextAnswer = false;
      statuses.push("lost");
      throw new TypeError("fetch failed");
    }
    statuses.push(status);
    return new Response(null, { status });
  }) as unknown as typeof fetch;

  const scope: () => OperationScope = () => ({
    name: "pipeline",
    config: {
      imageIdentifier: "arn:aws:lambda:us-east-1:123456789012:microvm-image:ci",
      executionRoleArn: "arn:aws:iam::123456789012:role/microvm-role",
      client: service.asClient(),
      fetch: endpointFetch,
    },
    partition: "aws",
    region: REGION,
    retryStrategy: defaultMicrovmRetryStrategy,
  });

  /** A durable context whose step runs its function once. */
  const child = {
    step: (_name: string, fn: (stepContext: unknown) => Promise<unknown>) =>
      fn({ logger: { info: () => {} } }),
  } as unknown as DurableContext;

  const launched: LaunchResult = {
    microvmId: "mvm-1",
    endpoint: ENDPOINT,
    delivery: "http",
  };

  /** Runs the request step of one session job, as `vm.invoke` does. */
  const deliver = (callbackId: string, resume = true) =>
    deliverJob(
      child,
      scope(),
      "job",
      launched,
      {},
      jobDocument(callbackId, { n: 1 }, undefined),
      { resume },
    );

  const runHook = () =>
    send(
      listener,
      `${HOOK_PATH_PREFIX}run`,
      {
        microvmId: "mvm-1",
        runHookPayload: JSON.stringify({
          version: 1,
          region: REGION,
          autoSuspendIdleSeconds: IDLE_SECONDS,
        }),
      },
      LAMBDA_HOOK_HEADERS,
    );

  /** Advances fake time in steps until `promise` settles. */
  async function settle<T>(promise: Promise<T>, maxMs: number): Promise<T> {
    let done = false;
    const result = promise.finally(() => {
      done = true;
    });
    for (let waited = 0; !done && waited < maxMs; waited += 100) {
      await jest.advanceTimersByTimeAsync(100);
    }
    expect(done).toBe(true);
    return result;
  }

  it("delivers a job that arrives during the 503 refusal after the MicroVM resumes", async () => {
    await runHook();
    service.holdSuspend = true;
    // The idle time ends. The worker calls SuspendMicrovm, which the service
    // holds, and refuses jobs from now on.
    await jest.advanceTimersByTimeAsync(IDLE_SECONDS * 1_000);
    expect(service.calls).toEqual(["suspend"]);

    // The state check finds RUNNING, so the job goes to the worker, which
    // answers 503.
    const delivery = deliver("cb-1");
    await jest.advanceTimersByTimeAsync(1_000);
    expect(statuses.length).toBeGreaterThan(0);
    expect(new Set(statuses)).toEqual(new Set([503]));
    // The service suspends the MicroVM. The next state check after a 503
    // finds it SUSPENDED and resumes it. The resume hook ends the refusal.
    service.finishSuspend();
    const suspendedAt = Date.now();

    await settle(delivery, 60_000);
    await listener.idle();

    // Without the resume hook, the refusal would last 30 seconds after the
    // suspend call returned. The next test covers that fallback.
    expect(Date.now() - suspendedAt).toBeLessThan(30_000);

    expect(statuses.at(-1)).toBe(202);
    expect(service.calls).toContain("get:SUSPENDED");
    expect(service.calls.filter((c) => c === "resume")).toHaveLength(1);
    expect(service.calls.indexOf("resume")).toBeGreaterThan(
      service.calls.indexOf("get:SUSPENDED"),
    );
    expect(ran).toEqual(['cb-1:{"n":1}']);
    expect(completions).toContain("SendDurableExecutionCallbackSuccessCommand");
  });

  it("delivers the job after the 30-second refusal when no resume hook arrives", async () => {
    service.sendResumeHook = false;
    await runHook();
    await jest.advanceTimersByTimeAsync(IDLE_SECONDS * 1_000);
    expect(service.state).toBe("SUSPENDED");
    const suspendedAt = Date.now();

    // The state check resumes the MicroVM, but the worker hears no resume
    // hook. So it refuses jobs until 30 seconds after its suspend call.
    const delivery = deliver("cb-1");
    await settle(delivery, 60_000);
    await listener.idle();

    expect(service.calls).toContain("resume");
    expect(statuses.filter((s) => s === 503).length).toBeGreaterThan(0);
    expect(statuses.at(-1)).toBe(202);
    expect(Date.now() - suspendedAt).toBeGreaterThanOrEqual(30_000);
    expect(ran).toEqual(['cb-1:{"n":1}']);
  });

  it("runs a job once when the endpoint loses the answer and the request step sends it again", async () => {
    await runHook();
    loseNextAnswer = true;

    // microvm() style: no state check before delivery.
    const delivery = deliver("cb-1", false);
    await settle(delivery, 10_000);
    await listener.idle();

    expect(statuses).toEqual(["lost", 202]);
    expect(ran).toEqual(['cb-1:{"n":1}']);
    expect(
      completions.filter(
        (c) => c === "SendDurableExecutionCallbackSuccessCommand",
      ),
    ).toHaveLength(1);
  });
});
