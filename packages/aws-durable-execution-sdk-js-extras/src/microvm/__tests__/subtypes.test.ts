import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  type TestResult,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { MicrovmOperationSubType, microvm, microvmSession } from "..";
import { baseConfig, FakeEndpoint, FakeMicrovmsClient } from "./fakes";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

type Runner = LocalDurableTestRunner<unknown>;

/** Lists every operation as [name, type, subtype], in history order. */
const history = (result: TestResult): [string?, string?, string?][] =>
  result
    .getOperations()
    .map((operation) => [
      operation.getName(),
      operation.getType(),
      operation.getSubType(),
    ]);

async function completeJob(runner: Runner, jobName: string): Promise<void> {
  const callback = runner.getOperation(`${jobName}.callback`);
  await callback.waitForData(WaitingOperationStatus.STARTED);
  await runner
    .getOperation(`${jobName}.request`)
    .waitForData(WaitingOperationStatus.COMPLETED);
  await callback.sendCallbackSuccess(JSON.stringify({ job: jobName }));
}

describe("MicrovmOperationSubType", () => {
  it("keeps its values fixed, because replay compares them with checkpoints", () => {
    expect(MicrovmOperationSubType).toEqual({
      MICROVM: "Microvm",
      SESSION: "MicrovmSession",
      SESSION_JOB: "MicrovmSessionJob",
      SESSION_ID: "MicrovmSessionId",
      LAUNCH: "MicrovmLaunch",
      REQUEST: "MicrovmRequest",
      TERMINATE: "MicrovmTerminate",
      CALLBACK: "MicrovmCallback",
    });
  });

  it("fits the service's subtype constraints", () => {
    for (const value of Object.values(MicrovmOperationSubType)) {
      expect(value).toMatch(/^[a-zA-Z0-9_-]{1,32}$/);
    }
  });

  it("labels every operation of microvm with run hook delivery", async () => {
    const client = new FakeMicrovmsClient();
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) =>
          microvm(context, "build", { repo: "org/app" }, baseConfig(client)),
      ),
    }) as Runner;

    const pending = runner.run({ payload: {} });
    const callback = runner.getOperation("build.callback");
    await callback.waitForData(WaitingOperationStatus.STARTED);
    await runner
      .getOperation("build.launch")
      .waitForData(WaitingOperationStatus.COMPLETED);
    await callback.sendCallbackSuccess(JSON.stringify({ passed: true }));
    const execution = await pending;
    expect(execution.getStatus()).toBe("SUCCEEDED");

    expect(history(execution)).toEqual([
      ["build", "CONTEXT", "Microvm"],
      ["build.callback", "CALLBACK", "MicrovmCallback"],
      ["build.launch", "STEP", "MicrovmLaunch"],
      ["build.terminate", "STEP", "MicrovmTerminate"],
    ]);
  });

  it("labels the request step of microvm with HTTP delivery", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) =>
          microvm(
            context,
            "build",
            { repo: "org/app" },
            {
              ...baseConfig(client),
              fetch: endpoint.fetch,
              request: { path: "/build" },
            },
          ),
      ),
    }) as Runner;

    const pending = runner.run({ payload: {} });
    await completeJob(runner, "build");
    const execution = await pending;
    expect(execution.getStatus()).toBe("SUCCEEDED");

    expect(history(execution)).toEqual([
      ["build", "CONTEXT", "Microvm"],
      ["build.callback", "CALLBACK", "MicrovmCallback"],
      ["build.launch", "STEP", "MicrovmLaunch"],
      ["build.request", "STEP", "MicrovmRequest"],
      ["build.terminate", "STEP", "MicrovmTerminate"],
    ]);
  });

  it("labels the session, its jobs, and leaves the handler's own operations alone", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) =>
          microvmSession(
            context,
            "pipeline",
            {
              ...baseConfig(client),
              timeout: { hours: 1 },
              fetch: endpoint.fetch,
            },
            async (vm, ctx) => {
              const build = await vm.invoke(
                "build",
                {},
                {
                  path: "/build",
                  timeout: { minutes: 10 },
                },
              );
              await ctx.step("between", async () => "ok");
              return build;
            },
          ),
      ),
    }) as Runner;

    const pending = runner.run({ payload: {} });
    await completeJob(runner, "build");
    const execution = await pending;
    expect(execution.getStatus()).toBe("SUCCEEDED");

    expect(history(execution)).toEqual([
      ["pipeline", "CONTEXT", "MicrovmSession"],
      ["pipeline.session", "STEP", "MicrovmSessionId"],
      ["pipeline.launch", "STEP", "MicrovmLaunch"],
      ["build", "CONTEXT", "MicrovmSessionJob"],
      ["build.callback", "CALLBACK", "MicrovmCallback"],
      ["build.request", "STEP", "MicrovmRequest"],
      ["between", "STEP", "Step"],
      ["pipeline.terminate", "STEP", "MicrovmTerminate"],
    ]);
  });
});
