import { afterEach, describe, expect, it, vi } from "vitest";
import { Server, ServerResponse } from "node:http";
import {
  type LambdaClient,
  SendDurableExecutionCallbackFailureCommand,
  SendDurableExecutionCallbackHeartbeatCommand,
  SendDurableExecutionCallbackSuccessCommand,
} from "@aws-sdk/client-lambda";
import {
  type AgentcoreJobHandler,
  type AgentcoreWorker,
  type AgentcoreWorkerLogger,
  startAgentcoreWorker,
} from "..";

/** Records every callback API call. `fail` answers a command with an error. */
class FakeLambdaClient {
  readonly calls: { name: string; input: Record<string, unknown> }[] = [];
  fail: Partial<Record<string, Error>> = {};

  async send(command: {
    constructor: { name: string };
    input: Record<string, unknown>;
  }): Promise<unknown> {
    const name = command.constructor.name;
    this.calls.push({ name, input: command.input });
    const error = this.fail[name];
    if (error) {
      throw error;
    }
    return {};
  }

  destroy(): void {}

  named(name: string): Record<string, unknown>[] {
    return this.calls.filter((c) => c.name === name).map((c) => c.input);
  }

  asClient(): LambdaClient {
    return this as unknown as LambdaClient;
  }
}

class RecordingLogger implements AgentcoreWorkerLogger {
  readonly lines: { level: string; message: string }[] = [];
  info(message: string): void {
    this.lines.push({ level: "info", message });
  }
  warn(message: string): void {
    this.lines.push({ level: "warn", message });
  }
  error(message: string): void {
    this.lines.push({ level: "error", message });
  }
}

const SUCCESS = SendDurableExecutionCallbackSuccessCommand.name;

// The real methods, for spies that record a call and then pass it on.
const originalEnd = ServerResponse.prototype.end;
const originalListen = Server.prototype.listen;
const FAILURE = SendDurableExecutionCallbackFailureCommand.name;
const HEARTBEAT = SendDurableExecutionCallbackHeartbeatCommand.name;

let worker: AgentcoreWorker | undefined;
afterEach(async () => {
  await worker?.idle();
  await worker?.close();
  worker = undefined;
});

async function start(
  handler: AgentcoreJobHandler,
  client = new FakeLambdaClient(),
  logger = new RecordingLogger(),
): Promise<{ client: FakeLambdaClient; logger: RecordingLogger }> {
  worker = await startAgentcoreWorker(
    { handler, createClient: () => client.asClient(), logger },
    0,
    "127.0.0.1",
  );
  return { client, logger };
}

const url = (path: string): string => `http://127.0.0.1:${worker?.port}${path}`;

async function invoke(
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url("/invocations"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function ping(): Promise<unknown> {
  return (await fetch(url("/ping"))).json();
}

const job = (callbackId: string, extra: Record<string, unknown> = {}) => ({
  version: 1,
  region: "us-east-1",
  callbackId,
  input: { pr: 7 },
  ...extra,
});

/** A promise and the function that resolves it. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe("startAgentcoreWorker", () => {
  it("answers ping with Healthy when idle and HealthyBusy while a job runs", async () => {
    const release = gate();
    await start(async () => {
      await release.promise;
      return "done";
    });

    expect(await ping()).toMatchObject({ status: "Healthy" });
    await invoke(job("cb-1"));
    expect(await ping()).toMatchObject({ status: "HealthyBusy" });
    release.open();
    await worker?.idle();
    expect(await ping()).toMatchObject({ status: "Healthy" });
  });

  it("sets time_of_last_update at start and at each status change only", async () => {
    // Only Date is faked, so the server and the requests still run.
    vi.useFakeTimers({ toFake: ["Date"], now: 1_000_000_000_000 });
    try {
      const first = gate();
      const second = gate();
      const gates = [first, second];
      const { client } = await start(async () => {
        await gates.shift()?.promise;
      });

      // At start.
      expect(await ping()).toEqual({
        status: "Healthy",
        time_of_last_update: 1_000_000_000,
      });
      // No status change: the time stays.
      vi.setSystemTime(1_000_000_010_000);
      expect(await ping()).toEqual({
        status: "Healthy",
        time_of_last_update: 1_000_000_000,
      });

      // A job starts: Healthy to HealthyBusy.
      await invoke(job("cb-1"));
      expect(await ping()).toEqual({
        status: "HealthyBusy",
        time_of_last_update: 1_000_000_010,
      });

      // A second job starts while busy: no change.
      vi.setSystemTime(1_000_000_020_000);
      await invoke(job("cb-2"));
      expect(await ping()).toEqual({
        status: "HealthyBusy",
        time_of_last_update: 1_000_000_010,
      });

      // One of two jobs ends: still busy, no change.
      vi.setSystemTime(1_000_000_030_000);
      first.open();
      // The first job has reported. Its job promise settles a few
      // microtasks later. setTimeout is real, so the wait lets it settle.
      await expect.poll(() => client.named(SUCCESS)).toHaveLength(1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await ping()).toEqual({
        status: "HealthyBusy",
        time_of_last_update: 1_000_000_010,
      });

      // The last job ends: HealthyBusy to Healthy.
      vi.setSystemTime(1_000_000_040_000);
      second.open();
      await worker?.idle();
      expect(await ping()).toEqual({
        status: "Healthy",
        time_of_last_update: 1_000_000_040,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a job at once, runs the handler, and reports its result", async () => {
    const seen: unknown[] = [];
    const { client } = await start(async (input, context) => {
      seen.push(input, context.callbackId, context.region);
      return { approved: true };
    });

    const answer = await invoke(job("cb-1"));
    await worker?.idle();

    expect(answer).toEqual({ status: 200, body: { accepted: true } });
    expect(seen).toEqual([{ pr: 7 }, "cb-1", "us-east-1"]);
    const [success] = client.named(SUCCESS);
    expect(success.CallbackId).toBe("cb-1");
    expect(Buffer.from(success.Result as Uint8Array).toString("utf8")).toBe(
      '{"approved":true}',
    );
    expect(client.named(FAILURE)).toEqual([]);
  });

  it("reports the handler's error as a callback failure", async () => {
    class ReviewFailed extends Error {
      override name = "ReviewFailed";
    }
    const { client } = await start(async () => {
      throw new ReviewFailed("3 comments");
    });

    await invoke(job("cb-1"));
    await worker?.idle();

    expect(client.named(FAILURE)).toEqual([
      {
        CallbackId: "cb-1",
        Error: { ErrorType: "ReviewFailed", ErrorMessage: "3 comments" },
      },
    ]);
    expect(client.named(SUCCESS)).toEqual([]);
  });

  it("reports a result over 256 KB as a failure", async () => {
    const { client } = await start(async () => "x".repeat(300 * 1024));

    await invoke(job("cb-1"));
    await worker?.idle();

    expect(client.named(SUCCESS)).toEqual([]);
    const [failure] = client.named(FAILURE);
    expect((failure.Error as { ErrorType: string }).ErrorType).toBe(
      "ResultTooLargeError",
    );
  });

  it("reports a result that is not JSON-serializable as a failure", async () => {
    const { client } = await start(async () => ({ n: 1n }));

    await invoke(job("cb-1"));
    await worker?.idle();

    expect(client.named(SUCCESS)).toEqual([]);
    const [failure] = client.named(FAILURE);
    expect((failure.Error as { ErrorType: string }).ErrorType).toBe(
      "ResultSerializationError",
    );
  });

  it("runs a callback ID once and accepts the repeat without running it", async () => {
    let runs = 0;
    const { client } = await start(async () => {
      runs++;
      return "ok";
    });

    const first = await invoke(job("cb-1"));
    await worker?.idle();
    const second = await invoke(job("cb-1"));
    await worker?.idle();

    expect(first.body).toEqual({ accepted: true });
    expect(second).toEqual({ status: 200, body: { accepted: true } });
    expect(runs).toBe(1);
    expect(client.named(SUCCESS)).toHaveLength(1);
  });

  it("forgets the oldest callback ID after 1,000 newer ones", async () => {
    const runs: string[] = [];
    await start(async (_input, context) => {
      runs.push(context.callbackId);
    });

    for (let i = 0; i <= 1_000; i++) {
      await invoke(job(`cb-${i}`));
    }
    await invoke(job("cb-1000"));
    await invoke(job("cb-0"));
    await worker?.idle();

    expect(runs.filter((id) => id === "cb-0")).toHaveLength(2);
    expect(runs.filter((id) => id === "cb-1000")).toHaveLength(1);
  });

  it.each<[string, unknown]>([
    ["a body that is not JSON", "{"],
    ["an unsupported version", job("cb-1", { version: 2 })],
    ["a document without a callback ID", job("")],
    ["a document without a Region", job("cb-1", { region: "" })],
  ])("answers 400 to %s and runs no job", async (_label, body) => {
    let runs = 0;
    const { client } = await start(async () => {
      runs++;
    });

    const answer = await invoke(body);
    await worker?.idle();

    expect(answer.status).toBe(400);
    expect(answer.body).toEqual({ error: expect.any(String) });
    expect(runs).toBe(0);
    expect(client.calls).toEqual([]);
  });

  it("answers 404 to any other route", async () => {
    await start(async () => undefined);

    const response = await fetch(url("/other"), { method: "POST" });
    await response.body?.cancel();

    expect(response.status).toBe(404);
  });

  it("answers ping with a query string, and only for GET", async () => {
    await start(async () => undefined);

    const withQuery = await fetch(url("/ping?probe=1"));
    const post = await fetch(url("/ping"), { method: "POST" });
    await post.body?.cancel();

    expect(withQuery.status).toBe(200);
    expect(await withQuery.json()).toMatchObject({ status: "Healthy" });
    expect(post.status).toBe(404);
  });

  it("accepts a job on /invocations with a query string", async () => {
    let runs = 0;
    await start(async () => {
      runs++;
    });

    const response = await fetch(url("/invocations?x=1"), {
      method: "POST",
      body: JSON.stringify(job("cb-1")),
    });
    await worker?.idle();

    expect(await response.json()).toEqual({ accepted: true });
    expect(runs).toBe(1);
  });

  it("writes the answer before the handler starts, so synchronous work cannot delay it", async () => {
    const order: string[] = [];
    const spy = vi
      .spyOn(ServerResponse.prototype, "end")
      .mockImplementation(function (this: ServerResponse, ...args: unknown[]) {
        order.push("answer");
        return originalEnd.apply(this, args as never);
      } as never);
    try {
      await start(async () => {
        order.push("handler");
        // Synchronous work, as in a handler that parses a large input.
        const until = Date.now() + 50;
        while (Date.now() < until) {
          // busy
        }
      });

      const answer = await invoke(job("cb-1"));
      await worker?.idle();

      expect(answer.body).toEqual({ accepted: true });
      expect(order).toEqual(["answer", "handler"]);
    } finally {
      spy.mockRestore();
    }
  });

  it.each<[string, string | undefined, string]>([
    ["without AGENTCORE_RUNTIME_URL", undefined, "127.0.0.1"],
    ["with AGENTCORE_RUNTIME_URL", "http://127.0.0.1:8080/", "0.0.0.0"],
  ])(
    "listens on port 8080 and the default host %s",
    async (_label, url, host) => {
      const binds: unknown[][] = [];
      // The real listen gets an ephemeral port on loopback, so the test binds
      // no fixed port and no external interface.
      const listen = vi
        .spyOn(Server.prototype, "listen")
        .mockImplementation(function (this: Server, ...args: unknown[]) {
          binds.push(args.slice(0, 2));
          return (originalListen as (...a: unknown[]) => Server).call(
            this,
            0,
            "127.0.0.1",
            args[2],
          );
        } as never);
      const saved = process.env.AGENTCORE_RUNTIME_URL;
      if (url === undefined) {
        delete process.env.AGENTCORE_RUNTIME_URL;
      } else {
        process.env.AGENTCORE_RUNTIME_URL = url;
      }
      try {
        worker = await startAgentcoreWorker({ handler: async () => undefined });
        expect(binds).toEqual([[8080, host]]);
      } finally {
        listen.mockRestore();
        if (saved === undefined) {
          delete process.env.AGENTCORE_RUNTIME_URL;
        } else {
          process.env.AGENTCORE_RUNTIME_URL = saved;
        }
      }
    },
  );

  it("listens on an explicit host even when AGENTCORE_RUNTIME_URL is set", async () => {
    const saved = process.env.AGENTCORE_RUNTIME_URL;
    process.env.AGENTCORE_RUNTIME_URL = "http://127.0.0.1:8080/";
    try {
      worker = await startAgentcoreWorker(
        { handler: async () => undefined, logger: new RecordingLogger() },
        0,
        "127.0.0.1",
      );
      expect(await ping()).toMatchObject({ status: "Healthy" });
    } finally {
      if (saved === undefined) {
        delete process.env.AGENTCORE_RUNTIME_URL;
      } else {
        process.env.AGENTCORE_RUNTIME_URL = saved;
      }
    }
  });

  it("keeps serving and logs one error when createClient throws", async () => {
    let calls = 0;
    const client = new FakeLambdaClient();
    const logger = new RecordingLogger();
    let runs = 0;
    worker = await startAgentcoreWorker(
      {
        handler: async () => {
          runs++;
          return "ok";
        },
        createClient: () => {
          calls++;
          if (calls === 1) {
            throw new Error("no credentials");
          }
          return client.asClient();
        },
        logger,
      },
      0,
      "127.0.0.1",
    );

    await invoke(job("cb-1"));
    await worker.idle();
    const second = await invoke(job("cb-2"));
    await worker.idle();

    expect(second.body).toEqual({ accepted: true });
    expect(runs).toBe(1);
    expect(client.named(SUCCESS)).toEqual([
      expect.objectContaining({ CallbackId: "cb-2" }),
    ]);
    expect(logger.lines.filter((line) => line.level === "error")).toEqual([
      {
        level: "error",
        message: "could not create the Lambda client for the job",
      },
    ]);
  });

  it("sends a heartbeat when the job has a heartbeat timeout", async () => {
    const release = gate();
    const { client } = await start(async () => {
      await release.promise;
    });

    await invoke(job("cb-1", { heartbeatTimeoutSeconds: 300 }));
    await expect.poll(() => client.named(HEARTBEAT)).toHaveLength(1);
    release.open();
    await worker?.idle();

    expect(client.named(HEARTBEAT)[0]).toEqual({ CallbackId: "cb-1" });
  });

  it("aborts the signal and reports nothing when a heartbeat finds the callback closed", async () => {
    const client = new FakeLambdaClient();
    client.fail[HEARTBEAT] = Object.assign(new Error("closed"), {
      name: "CallbackTimeoutException",
    });
    let aborted = false;
    const { logger } = await start(
      (_input, context) =>
        new Promise((resolve) => {
          context.signal.addEventListener("abort", () => {
            aborted = true;
            resolve("late");
          });
        }),
      client,
    );

    await invoke(job("cb-1", { heartbeatTimeoutSeconds: 300 }));
    await worker?.idle();

    expect(aborted).toBe(true);
    expect(client.named(SUCCESS)).toEqual([]);
    expect(logger.lines).toContainEqual({
      level: "warn",
      message: "job outcome not reported: the callback is gone",
    });
  });

  it("logs single-line JSON to the console without a logger", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const client = new FakeLambdaClient();
      client.fail[SUCCESS] = Object.assign(new Error("denied"), {
        name: "AccessDeniedException",
        $metadata: { httpStatusCode: 403 },
      });
      worker = await startAgentcoreWorker(
        {
          handler: async () => "ok",
          createClient: () => client.asClient(),
        },
        0,
        "127.0.0.1",
      );

      await invoke(job("cb-1"));
      await worker.idle();
      await invoke("{");

      expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
        level: "INFO",
        message: "job started",
        callbackId: "cb-1",
      });
      expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({
        level: "WARN",
        message: "invalid job document",
      });
      expect(JSON.parse(error.mock.calls[0][0] as string)).toMatchObject({
        level: "ERROR",
        message: "job outcome could not be reported",
      });
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("logs an error when the outcome cannot be reported", async () => {
    const client = new FakeLambdaClient();
    client.fail[SUCCESS] = Object.assign(new Error("denied"), {
      name: "AccessDeniedException",
      $metadata: { httpStatusCode: 403 },
    });
    const { logger } = await start(async () => "ok", client);

    await invoke(job("cb-1"));
    await worker?.idle();

    expect(logger.lines).toContainEqual({
      level: "error",
      message: "job outcome could not be reported",
    });
  });
});

describe("startAgentcoreWorker with a failing logger", () => {
  /** Collects the unhandled rejections while `run` runs. */
  async function unhandledDuring(run: () => Promise<void>): Promise<unknown[]> {
    const seen: unknown[] = [];
    const record = (reason: unknown): void => {
      seen.push(reason);
    };
    process.on("unhandledRejection", record);
    try {
      await run();
      // Node reports an unhandled rejection after the microtask queue
      // drains. So the check waits one timer turn.
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off("unhandledRejection", record);
    }
    return seen;
  }

  it.each<[string, (message: string) => unknown]>([
    [
      "throws synchronously on job started",
      (message) => {
        if (message === "job started") {
          throw new Error("logger broke");
        }
      },
    ],
    [
      "returns a rejected promise",
      () => Promise.reject(new Error("logger broke")),
    ],
  ])(
    "accepts the job and reports its outcome when the logger %s",
    async (_label, write) => {
      const client = new FakeLambdaClient();
      const logger = {
        info: write,
        warn: write,
        error: write,
      } as unknown as AgentcoreWorkerLogger;
      let answer: { status: number; body: unknown } | undefined;

      const unhandled = await unhandledDuring(async () => {
        await start(async () => "ok", client, logger as RecordingLogger);
        answer = await invoke(job("cb-1"));
        await worker?.idle();
      });

      expect(answer).toEqual({ status: 200, body: { accepted: true } });
      expect(client.named(SUCCESS).map((input) => input.CallbackId)).toEqual([
        "cb-1",
      ]);
      expect(unhandled).toEqual([]);
    },
  );
});

describe("startAgentcoreWorker session ID", () => {
  const SESSION_HEADER = "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id";

  /** A logger that keeps each line's data too. */
  function dataLogger(): {
    logger: AgentcoreWorkerLogger;
    lines: { message: string; data?: Record<string, unknown> }[];
  } {
    const lines: { message: string; data?: Record<string, unknown> }[] = [];
    const write = (message: string, data?: Record<string, unknown>): void => {
      lines.push({ message, data });
    };
    return { logger: { info: write, warn: write, error: write }, lines };
  }

  async function invokeWith(
    headers: Record<string, string>,
    body: unknown,
  ): Promise<number> {
    const response = await fetch(url("/invocations"), {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    await response.arrayBuffer();
    return response.status;
  }

  it.each([SESSION_HEADER, SESSION_HEADER.toLowerCase()])(
    "passes the session ID from the %s header to the handler and the log fields",
    async (header) => {
      const { logger, lines } = dataLogger();
      const seen: (string | undefined)[] = [];
      await start(
        async (_input, context) => {
          seen.push(context.sessionId);
          return "ok";
        },
        new FakeLambdaClient(),
        logger as RecordingLogger,
      );

      expect(await invokeWith({ [header]: "session-1" }, job("cb-1"))).toBe(
        200,
      );
      expect(await invokeWith({ [header]: "session-1" }, job("cb-1"))).toBe(
        200,
      );
      await worker?.idle();

      expect(seen).toEqual(["session-1"]);
      for (const message of [
        "job started",
        "job succeeded",
        "job already accepted",
      ]) {
        expect(lines.find((line) => line.message === message)?.data).toEqual({
          callbackId: "cb-1",
          runtimeSessionId: "session-1",
        });
      }
    },
  );

  it("leaves the session ID undefined without the header", async () => {
    const seen: unknown[] = [];
    await start(async (_input, context) => {
      seen.push("sessionId" in context, context.sessionId);
      return "ok";
    });

    await invokeWith({}, job("cb-1"));
    await worker?.idle();

    expect(seen).toEqual([false, undefined]);
  });
});
