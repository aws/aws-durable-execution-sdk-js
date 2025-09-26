import { withDurableFunctions } from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("LocalDurableTestRunner Invoke operations integration", () => {
  it("should invoke a function with no input and return the result", async () => {
    const handler = withDurableFunctions(async (_, ctx) => {
      const result1 = await ctx.invoke("nonDurableOperation", "myFunctionArn", {
        nonDurableInput: "foo",
      });
      const result2 = await ctx.invoke(
        "durableOperation",
        "myDurableFunctionArn",
        {
          durableInput: "bar",
        }
      );
      return {
        durableResult: result2,
        nonDurableResult: result1,
      };
    });

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    const nonDurableOperation = runner.getOperation("nonDurableOperation");
    const durableOperation = runner.getOperation("durableOperation");

    runner
      .registerFunction("myFunctionArn", async ({ nonDurableInput }) => {
        return Promise.resolve({
          type: "non-durable",
          input: nonDurableInput,
          message: "non-durable test result",
        });
      })
      .registerDurableFunction(
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
        })
      );

    const execution = await runner.run();

    expect(nonDurableOperation.getInvokeDetails()?.result).toEqual({
      type: "non-durable",
      input: "foo",
      message: "non-durable test result",
    });
    expect(durableOperation.getInvokeDetails()?.result).toEqual({
      type: "durable",
      input: "bar",
      message: "durable test result",
    });
    expect(execution.getHistoryEvents()).toEqual([
      {
        EventType: "InvokeStarted",
        SubType: "Invoke",
        EventId: 2,
        Id: "c4ca4238a0b92382",
        Name: "nonDurableOperation",
        EventTimestamp: expect.any(Number),
        InvokeStartedDetails: {
          Input: { Payload: JSON.stringify({ nonDurableInput: "foo" }) },
          FunctionArn: "myFunctionArn",
        },
      },
      {
        EventType: "InvokeSucceeded",
        SubType: "Invoke",
        EventId: 3,
        Id: "c4ca4238a0b92382",
        Name: "nonDurableOperation",
        EventTimestamp: expect.any(Number),
        InvokeSucceededDetails: {
          Result: {
            Payload: JSON.stringify({
              type: "non-durable",
              input: "foo",
              message: "non-durable test result",
            }),
          },
        },
      },
      {
        EventType: "InvokeStarted",
        SubType: "Invoke",
        EventId: 4,
        Id: "c81e728d9d4c2f63",
        Name: "durableOperation",
        EventTimestamp: expect.any(Number),
        InvokeStartedDetails: {
          Input: { Payload: JSON.stringify({ durableInput: "bar" }) },
          FunctionArn: "myDurableFunctionArn",
        },
      },
      {
        EventType: "InvokeSucceeded",
        SubType: "Invoke",
        EventId: 5,
        Id: "c81e728d9d4c2f63",
        Name: "durableOperation",
        EventTimestamp: expect.any(Number),
        InvokeSucceededDetails: {
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
      nonDurableResult: {
        type: "non-durable",
        input: "foo",
        message: "non-durable test result",
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
      })
    );

    const execution = await runner.run();

    expect(execution.getError()).toBeTruthy();
  });
});
