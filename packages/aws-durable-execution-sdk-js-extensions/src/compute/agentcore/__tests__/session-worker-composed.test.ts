// Runs agentcoreSession against the real worker server. The fakes stand in
// for the AgentCore data plane and the Lambda callback APIs only:
//
// 1. The fake AgentCore client forwards each InvokeAgentRuntime payload to
//    the worker's POST /invocations. It passes the runtime session ID in the
//    session header, as AgentCore Runtime does.
// 2. The worker's fake Lambda client completes the durable callback of the
//    job whose callback ID it reports.
//
// So the session ID, the job documents, and the callback results are
// checked across both packages for a session with more than one job.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  type AgentcoreWorker,
  startAgentcoreWorker,
} from "@aws/durable-execution-sdk-js-compute-worker/agentcore";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { agentcoreSession } from "..";
import { FakeAgentcoreClient, RUNTIME_ARN } from "./fakes";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

type Runner = LocalDurableTestRunner<unknown>;

const JOBS = ["write", "read"];

let worker: AgentcoreWorker | undefined;
let dir: string | undefined;
afterEach(async () => {
  await worker?.idle();
  await worker?.close();
  worker = undefined;
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

const silent = { info: () => {}, warn: () => {}, error: () => {} };

type LambdaClient = ReturnType<
  NonNullable<Parameters<typeof startAgentcoreWorker>[0]["createClient"]>
>;

/**
 * Completes the callback of the job whose callback ID the worker reports.
 * The success command has `Result`, and the failure command has `Error`. A
 * heartbeat has neither.
 */
function callbackClient(runner: () => Runner): LambdaClient {
  return {
    send: async (command: {
      input: {
        CallbackId: string;
        Result?: Uint8Array;
        Error?: Record<string, string>;
      };
    }) => {
      const {
        CallbackId: callbackId,
        Result: result,
        Error: error,
      } = command.input;
      const callback = JOBS.map((job) =>
        runner().getOperation(`${job}.callback`),
      ).find((op) => op.getCallbackDetails()?.callbackId === callbackId);
      if (callback === undefined) {
        throw new Error(`no callback with ID ${callbackId}`);
      }
      if (result !== undefined) {
        await callback.sendCallbackSuccess(
          Buffer.from(result).toString("utf8"),
        );
      } else if (error !== undefined) {
        await callback.sendCallbackFailure(error);
      }
      return {};
    },
    destroy: () => {},
  } as unknown as LambdaClient;
}

/** Sends each InvokeAgentRuntime payload to the worker. */
function forwardTo(client: FakeAgentcoreClient): void {
  client.onInvoke = async (input) => {
    const response = await fetch(
      `http://127.0.0.1:${worker?.port}/invocations`,
      {
        method: "POST",
        headers: {
          "content-type": input.contentType as string,
          "x-amzn-bedrock-agentcore-runtime-session-id":
            input.runtimeSessionId as string,
        },
        body: Buffer.from(input.payload as Uint8Array),
      },
    );
    const body = await response.text();
    return {
      statusCode: response.status,
      contentType: "application/json",
      response: { transformToString: async () => body },
    };
  };
}

describe("agentcoreSession with the real worker", () => {
  it("runs both jobs in one session, and the second job reads the file the first job wrote", async () => {
    dir = await mkdtemp(join(tmpdir(), "agentcore-session-"));
    const sessionIds: (string | undefined)[] = [];
    let runner: Runner | undefined;
    worker = await startAgentcoreWorker(
      {
        handler: async (input: { step: string }, context) => {
          sessionIds.push(context.sessionId);
          // AgentCore Runtime gives each session its own instance. So the
          // file path includes the session ID, and a job in another session
          // finds no file.
          const notes = join(dir as string, `${context.sessionId}.txt`);
          if (input.step === "write") {
            await writeFile(notes, "reviewed PR 7");
            return "written";
          }
          return readFile(notes, "utf8");
        },
        createClient: () => callbackClient(() => runner as Runner),
        logger: silent,
      },
      0,
      "127.0.0.1",
    );
    const client = new FakeAgentcoreClient();
    forwardTo(client);
    let sessionId: string | undefined;
    runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) =>
          agentcoreSession(
            context,
            "review",
            { agentRuntimeArn: RUNTIME_ARN, client: client.asClient() },
            async (session, child) => {
              sessionId = session.runtimeSessionId;
              const written = await session.invoke(
                child,
                "write",
                { step: "write" },
                { timeout: { minutes: 5 } },
              );
              const read = await session.invoke(
                child,
                "read",
                { step: "read" },
                { timeout: { minutes: 5 } },
              );
              return { written, read };
            },
          ),
      ),
    }) as Runner;

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({
      written: "written",
      read: "reviewed PR 7",
    });
    expect(sessionId).toEqual(expect.any(String));
    expect(sessionIds).toEqual([sessionId, sessionId]);
    expect(client.invokeInputs.map((i) => i.runtimeSessionId)).toEqual([
      sessionId,
      sessionId,
    ]);
    expect(client.stopInputs).toEqual([
      expect.objectContaining({ runtimeSessionId: sessionId }),
    ]);
  });
});
