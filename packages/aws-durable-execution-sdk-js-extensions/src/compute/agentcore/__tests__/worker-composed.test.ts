// Runs the agentcore operation against the real worker server. The fakes
// stand in for the AgentCore data plane and the Lambda callback APIs only:
//
// 1. The fake AgentCore client forwards each InvokeAgentRuntime payload to
//    the worker's POST /invocations, and returns the worker's answer as the
//    streamed response.
// 2. The worker's fake Lambda client completes the durable callback in the
//    local test runner.
//
// So the job document, the accepted answer, the dedup rule, and the
// callback result are checked across both packages.
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
import { agentcore } from "..";
import { baseConfig, FakeAgentcoreClient } from "./fakes";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

type Runner = LocalDurableTestRunner<unknown>;

let worker: AgentcoreWorker | undefined;
afterEach(async () => {
  await worker?.idle();
  await worker?.close();
  worker = undefined;
});

const silent = { info: () => {}, warn: () => {}, error: () => {} };

type LambdaClient = ReturnType<
  NonNullable<Parameters<typeof startAgentcoreWorker>[0]["createClient"]>
>;

/**
 * Completes the runner's callback from the worker's callback API calls. The
 * success command has `Result`, and the failure command has `Error`. A
 * heartbeat has neither.
 */
function callbackClient(runner: () => Runner): LambdaClient {
  return {
    send: async (command: {
      input: { Result?: Uint8Array; Error?: Record<string, string> };
    }) => {
      const callback = runner().getOperation("review.callback");
      const { Result: result, Error: error } = command.input;
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
function forwardTo(client: FakeAgentcoreClient, times = 1): void {
  client.onInvoke = async (input) => {
    let response: Response | undefined;
    for (let i = 0; i < times; i++) {
      response = await fetch(`http://127.0.0.1:${worker?.port}/invocations`, {
        method: "POST",
        headers: { "content-type": input.contentType as string },
        body: Buffer.from(input.payload as Uint8Array),
      });
    }
    const body = await (response as Response).text();
    return {
      statusCode: (response as Response).status,
      contentType: "application/json",
      response: { transformToString: async () => body },
    };
  };
}

describe("agentcore with the real worker", () => {
  it("runs the job in the worker and returns its result", async () => {
    let runner: Runner | undefined;
    worker = await startAgentcoreWorker(
      {
        handler: async (input: { pr: number }) => ({ reviewed: input.pr }),
        createClient: () => callbackClient(() => runner as Runner),
        logger: silent,
      },
      0,
      "127.0.0.1",
    );
    const client = new FakeAgentcoreClient();
    forwardTo(client);
    runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) =>
          agentcore(context, "review", { pr: 7 }, baseConfig(client)),
      ),
    }) as Runner;

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({ reviewed: 7 });
    expect(client.stopInputs).toHaveLength(1);
  });

  it("runs a job once when the same payload arrives twice", async () => {
    let runner: Runner | undefined;
    let runs = 0;
    worker = await startAgentcoreWorker(
      {
        handler: async () => {
          runs++;
          return "ok";
        },
        createClient: () => callbackClient(() => runner as Runner),
        logger: silent,
      },
      0,
      "127.0.0.1",
    );
    const client = new FakeAgentcoreClient();
    forwardTo(client, 2);
    runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) =>
          agentcore(context, "review", {}, baseConfig(client)),
      ),
    }) as Runner;

    const execution = await runner.run({ payload: {} });
    await worker.idle();

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(runs).toBe(1);
  });

  it("fails the operation with the worker's job error", async () => {
    let runner: Runner | undefined;
    worker = await startAgentcoreWorker(
      {
        handler: async () => {
          throw new RangeError("too many files");
        },
        createClient: () => callbackClient(() => runner as Runner),
        logger: silent,
      },
      0,
      "127.0.0.1",
    );
    const client = new FakeAgentcoreClient();
    forwardTo(client);
    runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) =>
          agentcore(context, "review", {}, baseConfig(client)),
      ),
    }) as Runner;

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()?.errorType).toBe("AgentcoreJobFailedError");
    expect(execution.getError()?.errorMessage).toMatch(
      /the job failed \(RangeError\): .*too many files/,
    );
  });
});
