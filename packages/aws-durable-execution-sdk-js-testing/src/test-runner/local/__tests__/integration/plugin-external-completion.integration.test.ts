import {
  withDurableExecution,
  type InvocationInfo,
  type OperationEndInfo,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";
import { WaitingOperationStatus } from "../../../types/durable-operation";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

it.each([
  ["wait", false],
  ["invoke", false],
  ["invoke", true],
  ["callback", false],
  ["callback", true],
] as const)(
  "reports the first %s completion (failure=%s) once, then replays it",
  async (kind, fails) => {
    const starts: InvocationInfo[] = [];
    const ends: OperationEndInfo[] = [];
    const body = jest.fn(async () => "checkpointed");
    const handler = withDurableExecution(
      async (_, ctx) => {
        const saved = await ctx.step("saved", body);
        let outcome: unknown;
        try {
          if (kind === "wait") {
            await ctx.wait("external", { seconds: 1 });
            outcome = "waited";
          } else if (kind === "invoke") {
            outcome = await ctx.invoke("external", "callee:1", {});
          } else {
            const [callback] = await ctx.createCallback("external");
            outcome = await callback;
          }
        } catch (error) {
          outcome = (error as Error).message;
        }
        const [resumeOne] = await ctx.createCallback("resume-one");
        await resumeOne;
        const [resumeTwo] = await ctx.createCallback("resume-two");
        await resumeTwo;
        return { saved, outcome };
      },
      {
        plugins: [
          {
            createPlugin: () => ({
              async onInvocationStart(info) {
                starts.push(info);
              },
              async onOperationEnd(info) {
                if (info.name === "external") ends.push(info);
              },
            }),
          },
        ],
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    if (kind === "invoke") {
      runner.registerDurableFunction(
        "callee:1",
        withDurableExecution(async (_, ctx) => {
          await ctx.wait("callee-wait", { seconds: 1 });
          if (fails) throw new Error("external failure");
          return "external result";
        }),
      );
    }
    const execution = runner.run();
    const external = runner.getOperation("external");
    await external.waitForData(WaitingOperationStatus.STARTED);
    await runner.pauseExecution();
    if (kind === "callback") {
      if (fails)
        await external.sendCallbackFailure({
          ErrorMessage: "external failure",
          ErrorType: "Error",
        });
      else await external.sendCallbackSuccess("external result");
    }
    await external.waitForData(WaitingOperationStatus.COMPLETED);
    await runner.resumeExecution();
    for (const name of ["resume-one", "resume-two"]) {
      const barrier = runner.getOperation(name);
      await barrier.waitForData(WaitingOperationStatus.STARTED);
      await runner.pauseExecution();
      await barrier.sendCallbackSuccess("continue");
      await runner.resumeExecution();
    }
    const result = await execution;
    expect(result.getStatus()).toBe("SUCCEEDED");
    expect(result.getResult()).toEqual({
      saved: "checkpointed",
      outcome: fails
        ? "external failure"
        : kind === "wait"
          ? "waited"
          : "external result",
    });
    expect(body).toHaveBeenCalledTimes(1);
    // Scheduling can add another resume; every observation after the first
    // must remain a replay, regardless of how many invocations are needed.
    expect(ends.length).toBeGreaterThanOrEqual(3);
    expect(ends[0].isReplay).toBe(false);
    expect(ends.slice(1).every((end) => end.isReplay)).toBe(true);
    expect(new Set(ends.map((end) => end.id)).size).toBe(1);
    expect(ends.map((end) => end.status)).toEqual(
      Array(ends.length).fill(fails ? "FAILED" : "SUCCEEDED"),
    );
    expect(
      starts.filter((start) => start.updatedOperations[ends[0].id]),
    ).toHaveLength(1);
    expect(starts[0].updatedOperations).toEqual({});
  },
  30000,
);
