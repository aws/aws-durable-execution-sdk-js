// Runs microvmSession with suspendAfter against the real worker listener, in
// one process. The fakes stand in for Lambda and the MicroVM endpoint only:
//
// 1. The worker's SuspendMicrovm sends the `suspend` hook, and then sets the
//    state to SUSPENDED. Lambda calls the hook before the freeze.
// 2. The session's ResumeMicrovm sends the `resume` hook, and then sets the
//    state to RUNNING.
// 3. The endpoint forwards each job to the worker while the MicroVM runs.
//    While it does not run, the endpoint answers HTTP 502 with
//    `x-aws-proxy-error: MICROVM_CONNECT_FAILED`, as the service does.
// 4. The worker reports each outcome with SendDurableExecutionCallbackSuccess.
//    The test passes that result to the test runner's callback.
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import {
  type DurableContext,
  type DurableLogger,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import {
  createMicrovmWorkerListener,
  HOOK_PATH_PREFIX,
  type MicrovmJobHandler,
  type MicrovmWorkerListener,
} from "@aws/durable-execution-sdk-js-microvm-worker";
import {
  ResumeMicrovmCommand,
  type RunMicrovmCommand,
  SuspendMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";
import {
  type MicrovmInvokeOptions,
  type MicrovmSessionHandler,
  microvmSession,
} from "..";
import { baseConfig, FakeMicrovmsClient, type SendOptions } from "./fakes";

type Runner = LocalDurableTestRunner<unknown>;

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

const ENDPOINT = "mvm-1.example";
const IGNORED_WARNING =
  "the worker in MicroVM mvm-1 does not support suspendAfter. The MicroVM keeps running after the job.";
const SUSPENDING_AFTER_JOB = "suspending the MicroVM after a job";

/** The headers of Lambda's own hook calls, as measured in us-east-1. */
const LAMBDA_HOOK_HEADERS = { host: "localhost:8080" };

interface Answer {
  status: number;
  headers: Record<string, string>;
}

/** Sends one request straight to the listener, and resolves with its answer. */
function send(
  listener: MicrovmWorkerListener,
  path: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<Answer> {
  return new Promise((resolve) => {
    const request = Object.assign(Readable.from([Buffer.from(body)]), {
      url: path,
      method: "POST",
      headers,
    });
    const answer: Answer = { status: 0, headers: {} };
    const response = {
      headersSent: false,
      writeHead(code: number, written: Record<string, string> = {}) {
        answer.status = code;
        answer.headers = written;
        this.headersSent = true;
        return this;
      },
      end() {
        resolve(answer);
        return this;
      },
    };
    listener.listener(
      request as unknown as IncomingMessage,
      response as unknown as ServerResponse,
    );
  });
}

/** The session's MicroVMs client. ResumeMicrovm sends the `resume` hook. */
class SessionMicrovms extends FakeMicrovmsClient {
  listener: MicrovmWorkerListener | undefined;

  override async send(command: unknown, options?: SendOptions) {
    if (command instanceof ResumeMicrovmCommand && this.listener) {
      this.events.push("resume");
      await send(
        this.listener,
        `${HOOK_PATH_PREFIX}resume`,
        "{}",
        LAMBDA_HOOK_HEADERS,
      );
      this.microvmState = "RUNNING";
      return {};
    }
    return super.send(command, options);
  }
}

/** One MicroVM with the real worker listener, and its endpoint. */
class SimulatedMicrovm {
  readonly client = new SessionMicrovms();
  readonly listener: MicrovmWorkerListener;
  /** The MicroVM IDs of the worker's SuspendMicrovm calls. */
  readonly suspended: string[] = [];
  /** The status of each request at the endpoint. */
  readonly answers: number[] = [];
  /** The worker's log messages. */
  readonly workerLog: string[] = [];
  /** The function's warnings. */
  readonly warnings: string[] = [];
  private readonly results = new Map<string, Promise<string>>();
  private readonly resolvers = new Map<string, (result: string) => void>();

  constructor(
    handler: MicrovmJobHandler,
    private readonly oldWorker = false,
  ) {
    const record = (message: string) => {
      this.workerLog.push(message);
    };
    this.listener = createMicrovmWorkerListener({
      handler,
      createClient: () =>
        ({
          send: async (command: {
            constructor: { name: string };
            input: { CallbackId: string; Result?: Uint8Array };
          }) => {
            if (
              command.constructor.name ===
              "SendDurableExecutionCallbackSuccessCommand"
            ) {
              const { CallbackId, Result } = command.input;
              this.resolver(CallbackId)(Buffer.from(Result ?? []).toString());
            }
            return {};
          },
        }) as unknown as ReturnType<
          NonNullable<
            Parameters<typeof createMicrovmWorkerListener>[0]["createClient"]
          >
        >,
      createMicrovmsClient: () =>
        ({
          send: async (command: unknown) => {
            if (command instanceof SuspendMicrovmCommand) {
              this.suspended.push(command.input.microvmIdentifier as string);
              await send(
                this.listener,
                `${HOOK_PATH_PREFIX}suspend`,
                "{}",
                LAMBDA_HOOK_HEADERS,
              );
              this.client.microvmState = "SUSPENDED";
            }
            return {};
          },
        }) as unknown as ReturnType<
          NonNullable<
            Parameters<
              typeof createMicrovmWorkerListener
            >[0]["createMicrovmsClient"]
          >
        >,
      logger: { info: record, warn: record, error: record },
    });
    this.client.listener = this.listener;
    // The launch sends the run hook, as Lambda does before RunMicrovm's
    // MicroVM takes jobs.
    this.client.runResponses = [
      async (input) => {
        await send(
          this.listener,
          `${HOOK_PATH_PREFIX}run`,
          JSON.stringify({
            microvmId: "mvm-1",
            runHookPayload: (input as RunMicrovmCommand["input"])
              .runHookPayload,
          }),
          LAMBDA_HOOK_HEADERS,
        );
        return { microvmId: "mvm-1", state: "PENDING", endpoint: ENDPOINT };
      },
    ];
  }

  private resolver(callbackId: string): (result: string) => void {
    this.result(callbackId);
    return this.resolvers.get(callbackId) as (result: string) => void;
  }

  /** The result that the worker reported for a callback ID. */
  result(callbackId: string): Promise<string> {
    let result = this.results.get(callbackId);
    if (!result) {
      result = new Promise((resolve) => {
        this.resolvers.set(callbackId, resolve);
      });
      this.results.set(callbackId, result);
    }
    return result;
  }

  /** The endpoint. */
  readonly fetch = (async (url: string, init: RequestInit) => {
    if (this.client.microvmState !== "RUNNING") {
      this.answers.push(502);
      return new Response(null, {
        status: 502,
        headers: { "x-aws-proxy-error": "MICROVM_CONNECT_FAILED" },
      });
    }
    let body = init.body as string;
    if (this.oldWorker) {
      // A worker that does not know the field behaves as if it were absent.
      const { suspendAfter: _ignored, ...rest } = JSON.parse(body);
      body = JSON.stringify(rest);
    }
    const answer = await send(this.listener, new URL(url).pathname, body);
    this.answers.push(answer.status);
    return new Response(null, {
      status: answer.status,
      headers: answer.headers,
    });
  }) as unknown as typeof fetch;

  /** Polls until the MicroVM has the state. */
  async waitFor(state: string): Promise<string> {
    for (let i = 0; i < 500; i++) {
      if (this.client.microvmState === state) {
        return state;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return `not ${state}`;
  }

  runner(
    handler: (microvm: SimulatedMicrovm) => MicrovmSessionHandler<unknown>,
  ) {
    const ignore = (): void => {};
    const logger: DurableLogger = {
      log: ignore,
      error: ignore,
      info: ignore,
      debug: ignore,
      warn: (message: string) => {
        this.warnings.push(message);
      },
    };
    return new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) => {
          context.configureLogger({ customLogger: logger });
          return microvmSession(
            context,
            "pipeline",
            {
              ...baseConfig(this.client),
              timeout: { minutes: 30 },
              fetch: this.fetch,
            },
            handler(this),
          );
        },
      ),
    }) as Runner;
  }

  /** Passes the worker's result for one job to the runner's callback. */
  async complete(runner: Runner, jobName: string): Promise<void> {
    const callback = runner.getOperation(`${jobName}.callback`);
    await callback.waitForData(WaitingOperationStatus.STARTED);
    const callbackId = callback.getCallbackDetails()?.callbackId as string;
    await callback.sendCallbackSuccess(await this.result(callbackId));
  }

  /** Runs the session, and completes the named jobs as the worker ends them. */
  async run(
    handler: (microvm: SimulatedMicrovm) => MicrovmSessionHandler<unknown>,
    jobNames: string[],
  ): Promise<unknown> {
    const runner = this.runner(handler);
    const executionPromise = runner.run({ payload: {} });
    await Promise.all(jobNames.map((name) => this.complete(runner, name)));
    const execution = await executionPromise;
    await this.listener.idle();
    this.listener.close();
    if (execution.getStatus() !== "SUCCEEDED") {
      throw new Error(JSON.stringify(execution.getError()));
    }
    return execution.getResult();
  }
}

const options = (suspendAfter = false): MicrovmInvokeOptions => ({
  timeout: { minutes: 1 },
  suspendAfter,
});

const echo: MicrovmJobHandler = async (input) => `${input} done`;

describe("suspendAfter with the real worker", () => {
  it("suspends after a job, and the next job resumes the MicroVM", async () => {
    const microvm = new SimulatedMicrovm(echo);

    const outcome = await microvm.run(
      (vm) => async (session, ctx) => {
        const first = await session.invoke(
          ctx,
          "build",
          "build",
          options(true),
        );
        const between = await ctx.step("pause", () => vm.waitFor("SUSPENDED"));
        const second = await session.invoke(ctx, "test", "test", options());
        return [first, between, second];
      },
      ["build", "test"],
    );

    expect(outcome).toEqual(["build done", "SUSPENDED", "test done"]);
    expect(microvm.suspended).toEqual(["mvm-1"]);
    expect(
      microvm.workerLog.filter((m) => m === SUSPENDING_AFTER_JOB),
    ).toHaveLength(1);
    // A replay of the completed job calls invoke again, so the flag is set.
    // The second job checks the state before delivery. So it resumes the
    // MicroVM before it sends the job, and gets no 502.
    expect(microvm.client.events.filter((e) => e === "resume")).toHaveLength(1);
    expect(microvm.answers).not.toContain(502);
    expect(microvm.client.microvmState).toBe("RUNNING");
    expect(microvm.warnings).not.toContain(IGNORED_WARNING);
    expect(microvm.client.events.at(-1)).toBe("terminate");
  });

  it("suspends once after a map with one suspendAfter item", async () => {
    // The items run at once. So the worker suspends only when the last of
    // them ends. The delay keeps each job running until every item has
    // delivered its job.
    const microvm = new SimulatedMicrovm(async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return `${input} done`;
    });

    const outcome = await microvm.run(
      (vm) => async (session, ctx) => {
        const shards = await ctx.map(
          "shards",
          ["a", "b", "c"],
          (itemContext, item) =>
            session.invoke(
              itemContext,
              `shard-${item}`,
              item,
              options(item === "a"),
            ),
        );
        const between = await ctx.step("pause", () => vm.waitFor("SUSPENDED"));
        const after = await session.invoke(ctx, "after", "after", options());
        return [shards.getResults(), between, after];
      },
      ["shard-a", "shard-b", "shard-c", "after"],
    );

    expect(outcome).toEqual([
      ["a done", "b done", "c done"],
      "SUSPENDED",
      "after done",
    ]);
    expect(microvm.suspended).toEqual(["mvm-1"]);
    expect(
      microvm.workerLog.filter((m) => m === SUSPENDING_AFTER_JOB),
    ).toHaveLength(1);
    // The job after the map resumed the MicroVM, with the flag or after a
    // 502, depending on which invocation ran item a.
    expect(microvm.client.events.filter((e) => e === "resume")).toHaveLength(1);
    expect(microvm.client.microvmState).toBe("RUNNING");
  });

  it("resumes the MicroVM through the check after a 502 when a replay lost the flag", async () => {
    // 1. The map item asks for a suspend after its job.
    // 2. A durable wait ends the invocation. The next invocation replays the
    //    completed map without running its item. So the flag is lost.
    // 3. The next job goes to the suspended MicroVM, and gets a 502 with
    //    MICROVM_CONNECT_FAILED. The request step checks the state, resumes
    //    the MicroVM, and sends the job again.
    const microvm = new SimulatedMicrovm(echo);

    const outcome = await microvm.run(
      (vm) => async (session, ctx) => {
        const shards = await ctx.map("shards", ["a"], (itemContext, item) =>
          session.invoke(itemContext, `shard-${item}`, item, options(true)),
        );
        const between = await ctx.step("pause", () => vm.waitFor("SUSPENDED"));
        await ctx.wait("wait", { seconds: 1 });
        const after = await session.invoke(ctx, "after", "after", options());
        return [shards.getResults(), between, after];
      },
      ["shard-a", "after"],
    );

    expect(outcome).toEqual([["a done"], "SUSPENDED", "after done"]);
    expect(microvm.suspended).toEqual(["mvm-1"]);
    // The job after the wait made no state check before delivery. Its first
    // request got the 502. The check after it found SUSPENDED, resumed the
    // MicroVM, and polled until RUNNING. The second request reached the
    // worker.
    expect(microvm.answers.slice(-2)).toEqual([502, 202]);
    const events = microvm.client.events;
    expect(events.slice(events.lastIndexOf("get:SUSPENDED"))).toEqual([
      "get:SUSPENDED",
      "resume",
      "get:RUNNING",
      "terminate",
    ]);
    expect(events.filter((e) => e === "resume")).toHaveLength(1);
    expect(microvm.client.microvmState).toBe("RUNNING");
  });

  it("warns once when an older worker ignores suspendAfter", async () => {
    const microvm = new SimulatedMicrovm(echo, true);

    const outcome = await microvm.run(
      () => async (session, ctx) => [
        await session.invoke(ctx, "build", "build", options(true)),
        await session.invoke(ctx, "test", "test", options(true)),
      ],
      ["build", "test"],
    );

    expect(outcome).toEqual(["build done", "test done"]);
    // The worker sent no acknowledgement, and never suspended the MicroVM.
    expect(microvm.suspended).toEqual([]);
    expect(microvm.workerLog).not.toContain(SUSPENDING_AFTER_JOB);
    expect(microvm.warnings.filter((w) => w === IGNORED_WARNING)).toHaveLength(
      1,
    );
    expect(microvm.client.events).not.toContain("resume");
    expect(microvm.answers).not.toContain(502);
  });
});
