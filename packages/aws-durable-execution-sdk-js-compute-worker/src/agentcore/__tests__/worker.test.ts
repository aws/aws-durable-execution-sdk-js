import { afterEach, describe, expect, it, vi } from "vitest";
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

    expect(await ping()).toEqual({ status: "Healthy" });
    await invoke(job("cb-1"));
    expect(await ping()).toEqual({ status: "HealthyBusy" });
    release.open();
    await worker?.idle();
    expect(await ping()).toEqual({ status: "Healthy" });
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
