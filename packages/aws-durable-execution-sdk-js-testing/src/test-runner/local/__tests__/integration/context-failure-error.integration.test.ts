import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";
import { WaitingOperationStatus } from "../../../types/durable-operation";

// A failed context (child context, map item, parallel branch, promise
// combinator, waitForCallback) checkpoints the error the SDK wrappers carry,
// not the wrapper. The error thrown to user code is rebuilt from that
// checkpoint on the live path too, so a replay throws the same shape.

jest.setTimeout(60_000);

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentError";
  }
}

const MSG = "card declined";
const noRetry = { retryStrategy: () => ({ shouldRetry: false }) };
/** A submitter that succeeds, so the callback is completed from outside. */
const submitNothing = async (): Promise<void> => undefined;

const failingStep = (ctx: DurableContext, name = "charge") =>
  ctx.step(
    name,
    async () => {
      throw new PaymentError(MSG);
    },
    noRetry,
  );

/** `Class(name): message` for the error and each cause below it. */
function chainOf(error: unknown): string[] {
  const chain: string[] = [];
  let current = error;
  for (let i = 0; i < 6 && current instanceof Error; i++) {
    chain.push(
      `${current.constructor.name}(${current.name}): ${current.message}`,
    );
    current = current.cause;
  }
  return chain;
}

interface Scenario {
  run: (ctx: DurableContext) => Promise<unknown>;
  /** The failed context operation, by name. */
  op: string;
  /** Its checkpointed ErrorType. */
  errorType: string;
  /** The error thrown to user code, live and replayed. */
  chain: string[];
  /** Fail the callback of the operation named "wfc" externally. */
  sendFailure?: { ErrorType?: string; ErrorMessage: string };
  message?: string;
}

const CHILD_STEP = [
  `ChildContextError(ChildContextError): ${MSG}`,
  `StepError(StepError): ${MSG}`,
  `Error(PaymentError): ${MSG}`,
];
const COMBINATOR_STEP = [
  `PromiseCombinatorError(PromiseCombinatorError): ${MSG}`,
  `StepError(StepError): ${MSG}`,
  `Error(PaymentError): ${MSG}`,
];
const SUBMITTER = (type: string) => [
  `CallbackSubmitterError(CallbackSubmitterError): ${MSG}`,
  `StepError(StepError): ${MSG}`,
  `Error(${type}): ${MSG}`,
];

const SCENARIOS: Record<string, Scenario> = {
  "child context throws": {
    run: (ctx) =>
      ctx.runInChildContext("child", async () => {
        throw new PaymentError(MSG);
      }),
    op: "child",
    errorType: "PaymentError",
    chain: CHILD_STEP,
  },
  "child context's step throws": {
    run: (ctx) => ctx.runInChildContext("child", (child) => failingStep(child)),
    op: "child",
    errorType: "PaymentError",
    chain: CHILD_STEP,
  },
  "nested child context's step throws": {
    run: (ctx) =>
      ctx.runInChildContext("child", (child) =>
        child.runInChildContext("inner", (inner) => failingStep(inner)),
      ),
    op: "child",
    errorType: "PaymentError",
    chain: CHILD_STEP,
  },
  "child context's invoke fails": {
    run: (ctx) =>
      ctx.runInChildContext("child", (child) =>
        child.invoke("pay", "payer", {}),
      ),
    op: "child",
    errorType: "PaymentError",
    chain: CHILD_STEP,
  },
  "map item's step throws": {
    run: async (ctx) => {
      const result = await ctx.map("fanout", ["a"], (item) =>
        failingStep(item, "item-step"),
      );
      result.throwIfError();
    },
    op: "map-item-0",
    errorType: "PaymentError",
    chain: CHILD_STEP,
  },
  "parallel branch's step throws": {
    run: async (ctx) => {
      const result = await ctx.parallel("par", [
        (branch) => failingStep(branch, "branch-step"),
      ]);
      result.throwIfError();
    },
    op: "parallel-branch-0",
    errorType: "PaymentError",
    chain: CHILD_STEP,
  },
  "promise.all over a failing step": {
    run: (ctx) => ctx.promise.all("combo", [failingStep(ctx)]),
    op: "combo",
    errorType: "PaymentError",
    chain: COMBINATOR_STEP,
  },
  "promise.race over a failing step": {
    run: (ctx) => ctx.promise.race("combo", [failingStep(ctx)]),
    op: "combo",
    errorType: "PaymentError",
    chain: COMBINATOR_STEP,
  },
  "waitForCallback submitter throws": {
    run: (ctx) =>
      ctx.waitForCallback(
        "wfc",
        async () => {
          throw new PaymentError(MSG);
        },
        { timeout: { seconds: 3600 }, ...noRetry },
      ),
    op: "wfc",
    errorType: "PaymentError",
    chain: SUBMITTER("PaymentError"),
  },
  "waitForCallback failed externally with type PaymentError": {
    run: (ctx) =>
      ctx.waitForCallback("wfc", submitNothing, {
        timeout: { seconds: 3600 },
      }),
    sendFailure: { ErrorType: "PaymentError", ErrorMessage: MSG },
    op: "wfc",
    errorType: "PaymentError",
    chain: SUBMITTER("PaymentError"),
  },
  'waitForCallback failed externally with type "Error"': {
    run: (ctx) =>
      ctx.waitForCallback("wfc", submitNothing, {
        timeout: { seconds: 3600 },
      }),
    sendFailure: { ErrorType: "Error", ErrorMessage: MSG },
    op: "wfc",
    errorType: "Error",
    chain: SUBMITTER("Error"),
  },
  "waitForCallback failed externally with no type": {
    run: (ctx) =>
      ctx.waitForCallback("wfc", submitNothing, {
        timeout: { seconds: 3600 },
      }),
    sendFailure: { ErrorMessage: MSG },
    op: "wfc",
    errorType: "CallbackExternalError",
    chain: [
      `CallbackExternalError(CallbackExternalError): ${MSG}`,
      `Error(CallbackExternalError): ${MSG}`,
    ],
  },
  "waitForCallback times out (not unwrapped)": {
    run: (ctx) =>
      ctx.waitForCallback("wfc", submitNothing, { timeout: { seconds: 1 } }),
    op: "wfc",
    errorType: "CallbackTimeoutError",
    message: "Callback timed out",
    chain: [
      "CallbackTimeoutError(CallbackTimeoutError): Callback timed out",
      "Error(CallbackTimeoutError): Callback timed out",
    ],
  },
  "child context fails with BatchCompletionError (not unwrapped)": {
    run: (ctx) =>
      ctx.runInChildContext("child", async (child) => {
        const result = await child.map("fanout", ["a"], async () => 1, {
          completionConfig: {
            shouldComplete: () => ({
              complete: true,
              outcome: "FAILED" as never,
            }),
          },
        });
        result.throwIfError();
      }),
    op: "child",
    errorType: "BatchCompletionError",
    message:
      "Batch completed as failed by shouldComplete (CUSTOM_COMPLETION_FAILED)",
    chain: [
      "ChildContextError(ChildContextError): Batch completed as failed by shouldComplete (CUSTOM_COMPLETION_FAILED)",
      "StepError(StepError): Batch completed as failed by shouldComplete (CUSTOM_COMPLETION_FAILED)",
      "Error(BatchCompletionError): Batch completed as failed by shouldComplete (CUSTOM_COMPLETION_FAILED)",
    ],
  },
};

describe.each([
  ["the default childOperationsDepth", undefined],
  ["childOperationsDepth Infinity", Infinity],
])("a failed context, with %s", (_label, depth) => {
  it.each(Object.entries(SCENARIOS))("%s", async (_title, scenario) => {
    // Every error the handler catches, one per invocation that reaches it:
    // the first is thrown live, the last is rebuilt from the checkpoint.
    const caught: string[][] = [];
    const handler = withDurableExecution(
      async (_event: unknown, ctx: DurableContext) => {
        try {
          await scenario.run(ctx);
        } catch (error) {
          caught.push(chainOf(error));
        }
        await ctx.wait("pause", { seconds: 1 });
        return "done";
      },
      depth === undefined
        ? undefined
        : { pluginsConfig: { childOperationsDepth: depth } },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerFunction("payer", async () => {
      throw new PaymentError(MSG);
    });

    const pending = runner.run({ payload: {} });
    if (scenario.sendFailure) {
      const operation = runner.getOperation(scenario.op);
      await operation.waitForData(WaitingOperationStatus.SUBMITTED);
      await operation.sendCallbackFailure(scenario.sendFailure);
    }
    await pending;

    expect(runner.getOperation(scenario.op).getContextDetails()?.error).toEqual(
      expect.objectContaining({
        errorType: scenario.errorType,
        errorMessage: scenario.message ?? MSG,
      }),
    );
    expect(caught.length).toBeGreaterThanOrEqual(2);
    expect(caught[0]).toEqual(scenario.chain);
    expect(caught.at(-1)).toEqual(scenario.chain);
  });
});

describe("a callback failed externally (createCallback)", () => {
  it.each([
    ["with type PaymentError", { ErrorType: "PaymentError" }, "PaymentError"],
    ['with type "Error"', { ErrorType: "Error" }, "Error"],
    ["with no type", {}, "CallbackExternalError"],
    ["with a blank type", { ErrorType: " \t" }, "CallbackExternalError"],
  ])(
    "%s keeps the type as cause.name, live and replayed",
    async (_t, type, causeName) => {
      const caught: string[][] = [];
      const handler = withDurableExecution(
        async (_event: unknown, ctx: DurableContext) => {
          const [promise] = await ctx.createCallback("cb", {
            timeout: { seconds: 3600 },
          });
          try {
            await promise;
          } catch (error) {
            caught.push(chainOf(error));
          }
          await ctx.wait("pause", { seconds: 1 });
          return "done";
        },
      );
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      const pending = runner.run({ payload: {} });
      const callback = runner.getOperation("cb");
      await callback.waitForData(WaitingOperationStatus.STARTED);
      await callback.sendCallbackFailure({ ...type, ErrorMessage: MSG });
      await pending;

      const expected = [
        `CallbackExternalError(CallbackExternalError): ${MSG}`,
        `Error(${causeName}): ${MSG}`,
      ];
      expect(caught.length).toBeGreaterThanOrEqual(2);
      expect(caught[0]).toEqual(expected);
      expect(caught.at(-1)).toEqual(expected);
    },
  );
});
