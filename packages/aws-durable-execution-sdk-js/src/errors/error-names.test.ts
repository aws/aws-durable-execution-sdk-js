import { afterEach, describe, expect, it } from "vitest";
import {
  BatchCompletionError,
  CallbackError,
  CallbackExternalError,
  CallbackSubmitterError,
  CallbackTimeoutError,
  ChildContextError,
  InvokeError,
  PromiseCombinatorError,
  StepError,
  WaitForConditionError,
} from "./durable-error/durable-error";
import {
  CheckpointUnrecoverableExecutionError,
  CheckpointUnrecoverableInvocationError,
} from "./checkpoint-errors/checkpoint-errors";
import { SerdesFailedError } from "./serdes-errors/serdes-errors";
import { NonDeterministicExecutionError } from "./non-deterministic-error/non-deterministic-error";

// A minifying bundler can rename a class, so `constructor.name` becomes a short
// name such as "e". Each error must keep its fixed name anyway.
const cases: Array<[string, { name: string }, () => Error]> = [
  ["StepError", StepError, () => new StepError()],
  ["CallbackError", CallbackError, () => new CallbackError()],
  [
    "CallbackExternalError",
    CallbackExternalError,
    () => new CallbackExternalError(),
  ],
  [
    "CallbackTimeoutError",
    CallbackTimeoutError,
    () => new CallbackTimeoutError(),
  ],
  [
    "CallbackSubmitterError",
    CallbackSubmitterError,
    () => new CallbackSubmitterError(),
  ],
  ["InvokeError", InvokeError, () => new InvokeError()],
  ["ChildContextError", ChildContextError, () => new ChildContextError()],
  [
    "PromiseCombinatorError",
    PromiseCombinatorError,
    () => new PromiseCombinatorError(),
  ],
  [
    "WaitForConditionError",
    WaitForConditionError,
    () => new WaitForConditionError(),
  ],
  [
    "BatchCompletionError",
    BatchCompletionError,
    () => new BatchCompletionError("CUSTOM_COMPLETION_FAILED"),
  ],
  [
    "CheckpointUnrecoverableInvocationError",
    CheckpointUnrecoverableInvocationError,
    () => new CheckpointUnrecoverableInvocationError(),
  ],
  [
    "CheckpointUnrecoverableExecutionError",
    CheckpointUnrecoverableExecutionError,
    () => new CheckpointUnrecoverableExecutionError(),
  ],
  ["SerdesFailedError", SerdesFailedError, () => new SerdesFailedError()],
  [
    "NonDeterministicExecutionError",
    NonDeterministicExecutionError,
    () => new NonDeterministicExecutionError("mismatch"),
  ],
];

const renamed: Array<{ name: string }> = [];

afterEach(() => {
  for (const errorClass of renamed.splice(0)) {
    Reflect.deleteProperty(errorClass, "name");
  }
});

describe("error names", () => {
  it.each(cases)(
    "%s keeps its name when the class is renamed",
    (expected, errorClass, create) => {
      Object.defineProperty(errorClass, "name", {
        value: "e",
        configurable: true,
      });
      renamed.push(errorClass);

      expect(create().name).toBe(expected);
    },
  );

  it("keeps the class name of a subclass outside the SDK", () => {
    class CustomStepError extends StepError {}
    class CustomCallbackTimeoutError extends CallbackTimeoutError {}
    class CustomSerdesError extends SerdesFailedError {}

    expect(new CustomStepError().name).toBe("CustomStepError");
    expect(new CustomCallbackTimeoutError().name).toBe(
      "CustomCallbackTimeoutError",
    );
    expect(new CustomSerdesError().name).toBe("CustomSerdesError");
  });
});
