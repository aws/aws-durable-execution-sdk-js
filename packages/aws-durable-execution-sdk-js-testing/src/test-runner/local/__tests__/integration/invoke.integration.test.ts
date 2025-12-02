import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("LocalDurableTestRunner Invoke operations integration", () => {
  it("should invoke a function with no input and return the result", async () => {
    const handler = withDurableExecution(async (_, ctx) => {
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
    });

    const durableOperation = runner.getOperation("durableOperation");

    runner.registerDurableFunction(
      "myDurableFunctionArn",
      withDurableExecution(async ({ durableInput }, ctx) => {
        const stepResult = await ctx.step("hello world", () => {
          return Promise.resolve("durable test result");
        });
        await ctx.wait({ seconds: 1 });
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
        EventId: 1,
        EventTimestamp: expect.any(Date),
        EventType: "ExecutionStarted",
        ExecutionStartedDetails: {
          Input: {
            Payload: "{}",
          },
        },
        Id: expect.any(String),
      },
      {
        EventType: "ChainedInvokeStarted",
        SubType: "ChainedInvoke",
        EventId: 2,
        Id: "c4ca4238a0b92382",
        Name: "durableOperation",
        EventTimestamp: expect.any(Date),
        ChainedInvokeStartedDetails: {
          DurableExecutionArn: "",
          FunctionName: "",
          Input: {
            Payload: "",
          },
        },
      },
      {
        EventId: 3,
        EventTimestamp: expect.any(Date),
        EventType: "InvocationCompleted",
        InvocationCompletedDetails: {
          EndTimestamp: expect.any(Date),
          Error: {},
          RequestId: expect.any(String),
          StartTimestamp: expect.any(Date),
        },
      },
      {
        EventType: "ChainedInvokeSucceeded",
        SubType: "ChainedInvoke",
        EventId: 4,
        Id: "c4ca4238a0b92382",
        Name: "durableOperation",
        EventTimestamp: expect.any(Date),
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
      {
        EventId: 5,
        EventTimestamp: expect.any(Date),
        EventType: "InvocationCompleted",
        InvocationCompletedDetails: {
          EndTimestamp: expect.any(Date),
          Error: {},
          RequestId: expect.any(String),
          StartTimestamp: expect.any(Date),
        },
      },
      {
        EventId: 6,
        EventTimestamp: expect.any(Date),
        EventType: "ExecutionSucceeded",
        ExecutionSucceededDetails: {
          Result: {
            Payload: JSON.stringify({
              durableResult: {
                type: "durable",
                input: "bar",
                message: "durable test result",
              },
            }),
          },
        },
        Id: expect.any(String),
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
    const handler = withDurableExecution(async (_, ctx) => {
      await ctx.invoke("durableOperation", "nonExistentFunction", {
        durableInput: "bar",
      });
    });

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
    });

    runner.registerDurableFunction(
      "myFunctionArn",
      withDurableExecution(async ({ nonDurableInput }) => {
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
