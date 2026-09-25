import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";

/**
 * A checkpoint answered without a `CheckpointToken`, end to end.
 *
 * The service withholds the token when an invocation may checkpoint no further. The SDK
 * abandons whatever it has not yet sent and suspends: the invocation reports PENDING, and the
 * abandoned work replays on the next invocation. `withholdCheckpointTokenOnCall` is what lets
 * a test reach that path.
 *
 * Both cases here withhold the token from the execution's first checkpoint call. What differs
 * is whether anything remains to wake the execution, which is what decides whether the
 * suspend costs an invocation or the whole execution -- see the second test.
 */
beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({
    withholdCheckpointTokenOnCall: 1,
  }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("checkpoint answered without a token", () => {
  it("suspends, replays the abandoned work, and finishes", async () => {
    const stepRuns: string[] = [];

    // The wait is what wakes the execution after the suspend. It is a sibling branch rather
    // than a preceding statement so that a step is still in flight when the token is
    // withheld, which is what leaves abandoned work to observe.
    const handler = withDurableExecution(async (_event, context) => {
      const results = await context.parallel("both", [
        {
          name: "gate",
          func: async (ctx) => {
            await ctx.wait("pause", { seconds: 1 });
            return "waited";
          },
        },
        {
          name: "work",
          func: async (ctx) =>
            ctx.step("do-work", async () => {
              // A real macrotask, so this step's SUCCEED belongs to a later checkpoint batch
              // than its START rather than being coalesced into the first call.
              await new Promise((resolve) => setTimeout(resolve, 20));
              stepRuns.push("do-work");
              return "worked";
            }),
        },
      ]);

      return results.getResults();
    });

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const execution = await runner.run({ payload: {} });

    // The suspend cost an invocation, not the execution.
    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual(["waited", "worked"]);

    // The step ran twice. Its START was accepted on the call that withheld the token; its
    // SUCCEED was never sent, so the next invocation had to run the body again. Once would
    // mean the SDK kept checkpointing after the token was withheld.
    expect(stepRuns).toEqual(["do-work", "do-work"]);
  }, 30000);

  it("strands an execution that had nothing else pending", async () => {
    // The limit of answering PENDING: it leaves the service to invoke again, and the SDK
    // cannot see whether anything will. Here nothing will -- no wait, callback or invoke was
    // outstanding when the token was withheld -- and the service rejects a PENDING response
    // in that position, which is what the local checkpoint server reproduces here. A fault
    // would have failed the execution too, so the suspend classification costs nothing on
    // this path. Withholding the token on a superseded invocation does not reach it, because
    // the invocation that superseded it is already driving the execution.
    const handler = withDurableExecution(async (_event, context) =>
      context.step("only-step", async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return "done";
      }),
    );

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    await expect(runner.run({ payload: {} })).rejects.toMatchObject({
      error: {
        ErrorMessage:
          "Cannot return PENDING status with no pending operations.",
      },
    });
  }, 30000);
});
