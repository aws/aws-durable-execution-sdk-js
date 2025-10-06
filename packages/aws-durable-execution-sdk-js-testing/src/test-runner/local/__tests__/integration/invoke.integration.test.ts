import { withDurableFunctions } from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("LocalDurableTestRunner Invoke operations integration", () => {
  it("should invoke a function with no input and return the result", async () => {
    const handler = withDurableFunctions(async (_, ctx) => {
      const result = await ctx.invoke(
        "durableOperation",
        "myDurableFunctionArn",
        {
          durableInput: "bar",
        },
      );
      return {
        durableResult: result,
      };
    });

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    const durableOperation = runner.getOperation("durableOperation");

    runner.registerDurableFunction(
      "myDurableFunctionArn",
      withDurableFunctions(async ({ durableInput }, ctx) => {
        const stepResult = await ctx.step("hello world", () => {
          return Promise.resolve("durable test result");
        });
        await ctx.wait(1000);
        return {
          type: "durable",
          input: durableInput,
          message: stepResult,
        };
      }),
    );

    const execution = await runner.run();

    expect(durableOperation.getChainedInvokeDetails()?.result).toEqual({
      type: "durable",
      input: "bar",
      message: "durable test result",
    });
    expect(execution.getHistoryEvents()).toEqual([
      {
        EventType: "ChainedInvokeStarted",
        SubType: "ChainedInvoke",
        EventId: 2,
        Id: "c4ca4238a0b92382",
        Name: "durableOperation",
        EventTimestamp: expect.any(Number),
        ChainedInvokeStartedDetails: {
          DurableExecutionArn: "",
        },
      },
      // TODO: add support for PENDING chained invoke operation
      {
        EventType: "ChainedInvokeSucceeded",
        SubType: "ChainedInvoke",
        EventId: 3,
        Id: "c4ca4238a0b92382",
        Name: "durableOperation",
        EventTimestamp: expect.any(Number),
        ChainedInvokeSucceededDetails: {
          Result: {
            Payload: JSON.stringify({
              type: "durable",
              input: "bar",
              message: "durable test result",
            }),
          },
        },
      },
    ]);
    expect(execution.getResult()).toEqual({
      durableResult: {
        type: "durable",
        input: "bar",
        message: "durable test result",
      },
    });
  });

  // TODO: handling errors for callback and checkpoint updates
  it.skip("should fail execution if invoking a function that does not exist", async () => {
    const handler = withDurableFunctions(async (_, ctx) => {
      await ctx.invoke("durableOperation", "nonExistentFunction", {
        durableInput: "bar",
      });
    });

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    runner.registerDurableFunction(
      "myFunctionArn",
      withDurableFunctions(async ({ nonDurableInput }) => {
        return Promise.resolve({
          type: "non-durable",
          input: nonDurableInput,
          message: "non-durable test result",
        });
      }),
    );

    const execution = await runner.run();

    expect(execution.getError()).toBeTruthy();
  });
});
