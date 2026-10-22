import {
  BatchCompletionError,
  CallbackExternalError,
  CallbackSubmitterError,
  CallbackTimeoutError,
  ChildContextError,
  InvokeError,
  PromiseCombinatorError,
  StepError,
  WaitForConditionError,
  CallbackError,
  createCallbackFailureError,
} from "../../errors/durable-error/durable-error";
import {
  MAX_WRAPPER_UNWRAP_DEPTH,
  createContextFailureErrorObject,
  unwrapSdkWrapperErrors,
} from "./error-object";

class PaymentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PaymentError";
  }
}

describe("unwrapSdkWrapperErrors", () => {
  const user = new PaymentError("card declined");

  it.each([
    ["StepError", (c: Error) => new StepError(c.message, c)],
    ["CallbackError", (c: Error) => new CallbackError(c.message, c)],
    [
      "CallbackExternalError",
      (c: Error) => new CallbackExternalError(c.message, c),
    ],
    [
      "CallbackSubmitterError",
      (c: Error) => new CallbackSubmitterError(c.message, c),
    ],
    ["InvokeError", (c: Error) => new InvokeError(c.message, c)],
    ["ChildContextError", (c: Error) => new ChildContextError(c.message, c)],
    [
      "PromiseCombinatorError",
      (c: Error) => new PromiseCombinatorError(c.message, c),
    ],
    [
      "WaitForConditionError",
      (c: Error) => new WaitForConditionError(c.message, c),
    ],
  ])("unwraps %s", (_type, wrap) => {
    expect(unwrapSdkWrapperErrors(wrap(user))).toBe(user);
  });

  it("follows a chain of wrappers", () => {
    const chain = new ChildContextError(
      "x",
      new PromiseCombinatorError("x", new StepError("x", user)),
    );
    expect(unwrapSdkWrapperErrors(chain)).toBe(user);
  });

  it("never unwraps CallbackTimeoutError or BatchCompletionError", () => {
    const timeout = new CallbackTimeoutError("t", user);
    const batch = new BatchCompletionError(
      "CUSTOM_COMPLETION_FAILED" as never,
      undefined,
      user,
    );
    expect(unwrapSdkWrapperErrors(new StepError("t", timeout))).toBe(timeout);
    expect(unwrapSdkWrapperErrors(new StepError("b", batch))).toBe(batch);
  });

  it("never unwraps a user error, even with a cause or an errorType", () => {
    const withCause = new PaymentError("x", { cause: new TypeError("inner") });
    expect(unwrapSdkWrapperErrors(withCause)).toBe(withCause);
    const lambdaStyle = Object.assign(new Error("x", { cause: user }), {
      errorType: "LambdaStyleError",
    });
    expect(unwrapSdkWrapperErrors(lambdaStyle)).toBe(lambdaStyle);
  });

  it("stops at a wrapper without an error-like cause", () => {
    const bare = new ChildContextError("Child context failed");
    expect(unwrapSdkWrapperErrors(bare)).toBe(bare);
    const stringCause = new StepError("x");
    (stringCause as { cause?: unknown }).cause = "not an error";
    expect(unwrapSdkWrapperErrors(stringCause)).toBe(stringCause);
  });

  it("stops at the last error before a cycle", () => {
    const a = new StepError("a");
    const b = new ChildContextError("b", a);
    a.cause = b;
    expect(unwrapSdkWrapperErrors(b)).toBe(a);
    const self = new StepError("self");
    self.cause = self;
    expect(unwrapSdkWrapperErrors(self)).toBe(self);
  });

  it(`passes at most ${MAX_WRAPPER_UNWRAP_DEPTH} wrappers`, () => {
    const build = (wrappers: number): Error => {
      let error: Error = user;
      for (let i = 0; i < wrappers; i++) error = new StepError(`w${i}`, error);
      return error;
    };
    expect(unwrapSdkWrapperErrors(build(MAX_WRAPPER_UNWRAP_DEPTH))).toBe(user);
    const deep = unwrapSdkWrapperErrors(
      build(MAX_WRAPPER_UNWRAP_DEPTH + 1),
    ) as StepError;
    expect(deep).toBeInstanceOf(StepError);
    expect(deep.message).toBe("w0");
  });

  it("returns a non-error value as it is", () => {
    expect(unwrapSdkWrapperErrors("boom")).toBe("boom");
    expect(unwrapSdkWrapperErrors(undefined)).toBeUndefined();
  });
});

describe("createContextFailureErrorObject", () => {
  it("checkpoints the wrapped error's type and message", () => {
    const error = new ChildContextError(
      "card declined",
      new StepError("card declined", new PaymentError("card declined")),
    );
    expect(createContextFailureErrorObject(error)).toEqual({
      ErrorType: "PaymentError",
      ErrorMessage: "card declined",
      ErrorData: undefined,
      StackTrace: undefined,
    });
  });

  it("keeps the nearest wrapper errorData when the wrapped error has none", () => {
    const remote = new Error("card declined");
    remote.name = "PaymentError";
    const error = new StepError(
      "card declined",
      new InvokeError("card declined", remote, '{"code":42}'),
    );
    expect(createContextFailureErrorObject(error)).toMatchObject({
      ErrorType: "PaymentError",
      ErrorData: '{"code":42}',
    });
  });

  it("checkpoints a wrapper that wraps nothing under its own type", () => {
    expect(
      createContextFailureErrorObject(new CallbackExternalError("failed")),
    ).toMatchObject({ ErrorType: "CallbackExternalError" });
  });

  it("checkpoints a non-wrapper as before", () => {
    expect(
      createContextFailureErrorObject(new CallbackTimeoutError("timed out")),
    ).toMatchObject({ ErrorType: "CallbackTimeoutError" });
    expect(
      createContextFailureErrorObject(new PaymentError("x")),
    ).toMatchObject({ ErrorType: "PaymentError" });
    expect(createContextFailureErrorObject("boom")).toEqual({
      ErrorData: undefined,
      ErrorMessage: "Unknown error",
    });
  });
});

describe("createCallbackFailureError", () => {
  it.each([
    ["PaymentError", "PaymentError"],
    ["Error", "Error"],
    [undefined, "CallbackExternalError"],
    ["", "CallbackExternalError"],
    [" \t\n\r\f\v", "CallbackExternalError"],
    ["\u00a0", "\u00a0"],
  ])("names the cause of an external failure typed %j %j", (type, name) => {
    const error = createCallbackFailureError(
      { ErrorType: type, ErrorMessage: "m", ErrorData: "d" },
      false,
    );
    expect(error).toBeInstanceOf(CallbackExternalError);
    expect(error.message).toBe("m");
    expect(error.errorData).toBe("d");
    expect(error.cause?.name).toBe(name);
    expect(error.cause?.message).toBe("m");
  });

  it("names the cause of an untyped timeout CallbackTimeoutError", () => {
    const error = createCallbackFailureError({ ErrorMessage: "m" }, true);
    expect(error).toBeInstanceOf(CallbackTimeoutError);
    expect(error.cause?.name).toBe("CallbackTimeoutError");
  });

  it("builds a cause-less error when there is no error object", () => {
    const external = createCallbackFailureError(undefined, false);
    expect(external).toBeInstanceOf(CallbackExternalError);
    expect(external.message).toBe("Callback failed");
    expect(external.cause).toBeUndefined();
    const timeout = createCallbackFailureError(undefined, true);
    expect(timeout).toBeInstanceOf(CallbackTimeoutError);
    expect(timeout.message).toBe("Callback timed out");
  });
});
