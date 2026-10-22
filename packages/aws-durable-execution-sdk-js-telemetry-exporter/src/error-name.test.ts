import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CallbackExternalError,
  CallbackSubmitterError,
  CallbackTimeoutError,
  ChildContextError,
  DurableOperationError,
  InvokeError,
  PromiseCombinatorError,
  StepError,
  type OperationInfo,
} from "@aws/durable-execution-sdk-js";
import {
  executionErrorName,
  operationErrorName,
  reduceTypeName,
} from "./error-name";

/**
 * Table A of the cross-SDK error.name rule. The JSON file is shared byte for
 * byte with the Python and Java exporters; do not edit it here only.
 */
const vectors = JSON.parse(
  readFileSync(
    join(__dirname, "__fixtures__", "error-name-vectors.json"),
    "utf8",
  ),
) as {
  version: number;
  reduce: { id: string; input: string | null; expected: string }[];
};

describe("reduceTypeName (shared vectors, Table A)", () => {
  it("loads the shared vector file", () => {
    expect(vectors.version).toBe(2);
    expect(vectors.reduce.map((v) => v.id)).toEqual(
      expect.arrayContaining(["A13", "A14", "A15", "A16", "A17"]),
    );
  });

  it.each(vectors.reduce.map((v) => [v.id, v.input, v.expected] as const))(
    "%s: %j -> %j",
    (_id, input, expected) => {
      expect(reduceTypeName(input)).toBe(expected);
    },
  );

  it("reports Error for a missing name", () => {
    expect(reduceTypeName(undefined)).toBe("Error");
  });

  it("counts only the six ASCII whitespace characters as blank (rule 6)", () => {
    for (const blank of [" ", "\t", "\n", "\r", "\f", "\v", " \t\n\r\f\v"]) {
      expect(reduceTypeName(blank)).toBe("Error");
    }
    for (const kept of [
      "\u00a0",
      "\ufeff",
      "\u001c",
      "\u2003",
      "\u3000",
      "\u200b",
      "\u0085",
      "\u2028",
      " \u00a0 ",
    ]) {
      expect(reduceTypeName(kept)).toBe(kept);
    }
  });

  it("converts a non-string name with String(...)", () => {
    expect(reduceTypeName(42)).toBe("42");
    expect(reduceTypeName({ toString: () => "a.Custom" })).toBe("Custom");
    expect(reduceTypeName(Symbol("Sym"))).toBe("Symbol(Sym)");
  });

  it("reports Error when converting the name throws", () => {
    expect(
      reduceTypeName({
        toString() {
          throw new Error("hostile");
        },
      }),
    ).toBe("Error");
  });
});

class PaymentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PaymentError";
  }
}

/** The operation error the SDK hands a plugin: a rebuild of the checkpoint. */
const checkpointed = (
  ErrorType: string | undefined,
  ErrorMessage = "card declined",
) => DurableOperationError.fromErrorObject({ ErrorType, ErrorMessage });

/** A plain error with a given name, as the SDK synthesizes for a cause. */
const named = (name: string, message = "card declined"): Error => {
  const e = new Error(message);
  e.name = name;
  return e;
};

const op = (
  partial: Partial<OperationInfo> & { id: string },
): OperationInfo => ({
  type: "STEP",
  isReplay: false,
  ...partial,
});

describe("executionErrorName", () => {
  const resolve = executionErrorName;

  it("names the user error behind one SDK wrapper", () => {
    expect(
      resolve(
        new StepError("card declined", new PaymentError("card declined")),
      ),
    ).toBe("PaymentError");
  });

  it("walks the whole chain of SDK wrappers (rule 3)", () => {
    const error = new ChildContextError(
      "card declined",
      new StepError("card declined", named("PaymentError")),
    );
    expect(resolve(error)).toBe("PaymentError");
    expect(
      resolve(
        new PromiseCombinatorError(
          "card declined",
          checkpointed("PaymentError"),
        ),
      ),
    ).toBe("PaymentError");
  });

  describe("unwraps at most 16 wrappers (rule 3)", () => {
    /**
     * `count` wrappers around a PaymentError. The innermost wrapper is a
     * ChildContextError and the next an InvokeError, so the name reported
     * after 16 unwraps shows exactly which error the walk stopped at.
     */
    const wrapped = (count: number): Error => {
      let error: Error = named("PaymentError");
      for (let i = 0; i < count; i++) {
        error =
          i === 0
            ? new ChildContextError("x", error)
            : i === 1
              ? new InvokeError("x", error)
              : new StepError("x", error);
      }
      return error;
    };

    it.each([
      [1, "PaymentError"],
      [15, "PaymentError"],
      // 16 unwraps reach the user error.
      [16, "PaymentError"],
      // 16 unwraps reach the innermost wrapper, which is reported.
      [17, "ChildContextError"],
      // 16 unwraps reach the second innermost wrapper.
      [18, "InvokeError"],
    ])("%i wrappers -> %s", (count, expected) => {
      expect(resolve(wrapped(count))).toBe(expected);
    });
  });

  describe("stops at a cycle and reports the last error before the repeat (rule 3)", () => {
    it("a self-cycle reports the wrapper itself", () => {
      const self = new ChildContextError("x");
      self.cause = self;
      expect(resolve(self)).toBe("ChildContextError");
    });

    it("a two-wrapper cycle reports the second wrapper", () => {
      const a = new StepError("x");
      const b = new ChildContextError("x", a);
      a.cause = b;
      // b -> a -> b: a is the last error visited before b repeats.
      expect(resolve(b)).toBe("StepError");
      expect(resolve(a)).toBe("ChildContextError");
    });

    it("a cycle after a prefix reports the last error before the repeat", () => {
      const inner = new PromiseCombinatorError("x");
      const middle = new ChildContextError("x", inner);
      inner.cause = middle;
      const outer = new StepError("x", middle);
      // outer -> middle -> inner -> middle: inner is reported.
      expect(resolve(outer)).toBe("PromiseCombinatorError");
    });
  });

  it("never unwraps a user error, even one with errorType and a cause (rule 2, B15)", () => {
    class LambdaStyleError extends Error {
      errorType = "LambdaStyleError";
      constructor(message: string, cause: Error) {
        super(message, { cause });
        this.name = "LambdaStyleError";
      }
    }
    expect(resolve(new LambdaStyleError("declined", new TypeError("x")))).toBe(
      "LambdaStyleError",
    );
  });

  it("never unwraps a user error's ES2022 cause (B14)", () => {
    expect(
      resolve(new PaymentError("card declined", { cause: new TypeError("x") })),
    ).toBe("PaymentError");
  });

  it("never unwraps a callback timeout (B11)", () => {
    expect(
      resolve(new CallbackTimeoutError("Callback timed out", named("Error"))),
    ).toBe("CallbackTimeoutError");
    expect(
      resolve(
        new ChildContextError(
          "Callback timed out",
          checkpointed("CallbackTimeoutError", "Callback timed out"),
        ),
      ),
    ).toBe("CallbackTimeoutError");
  });

  it("names an external callback failure after the cause the SDK built (B12, B13, B13b)", () => {
    expect(
      resolve(
        new CallbackExternalError("card declined", named("PaymentError")),
      ),
    ).toBe("PaymentError");
    // The SDK names the cause of a failure with no type after its own class.
    expect(
      resolve(
        new CallbackExternalError(
          "card declined",
          named("CallbackExternalError"),
        ),
      ),
    ).toBe("CallbackExternalError");
    expect(resolve(new CallbackExternalError("Callback failed"))).toBe(
      "CallbackExternalError",
    );
    // The explicit type "Error" is a type.
    expect(
      resolve(new CallbackExternalError("card declined", named("Error"))),
    ).toBe("Error");
  });

  it("names an invoke failure by the invoked function's error type (B9)", () => {
    expect(
      resolve(new InvokeError("card declined", named("PaymentError"))),
    ).toBe("PaymentError");
    expect(resolve(new InvokeError("Invoke failed"))).toBe("InvokeError");
  });

  it("reduces the user's type name and reports Error for a blank one", () => {
    expect(
      resolve(new StepError("x", named("com.acme.Outer$PaymentError"))),
    ).toBe("PaymentError");
    expect(resolve(new StepError("x", named(" \t")))).toBe("Error");
  });

  it("reports the wrapper type an older SDK checkpointed (rule 9)", () => {
    expect(
      resolve(
        new ChildContextError("card declined", checkpointed("StepError")),
      ),
    ).toBe("StepError");
  });
});

describe("operationErrorName", () => {
  it("names an operation by its own checkpointed type (B1, B3 to B10, B19)", () => {
    for (const type of ["STEP", "CONTEXT", "CHAINED_INVOKE"]) {
      expect(
        operationErrorName(
          op({
            id: "o",
            type,
            status: "FAILED",
            error: checkpointed("PaymentError"),
          }),
        ),
      ).toBe("PaymentError");
    }
  });

  it("names each failed sibling by its own type (B20, B21)", () => {
    expect(
      operationErrorName(
        op({ id: "a", type: "CONTEXT", error: checkpointed("PaymentError") }),
      ),
    ).toBe("PaymentError");
    expect(
      operationErrorName(
        op({ id: "b", type: "CONTEXT", error: checkpointed("FraudError") }),
      ),
    ).toBe("FraudError");
  });

  it("reports the wrapper type an older SDK checkpointed (rule 9)", () => {
    expect(
      operationErrorName(
        op({ id: "c", type: "CONTEXT", error: checkpointed("StepError") }),
      ),
    ).toBe("StepError");
  });

  it("does not unwrap a checkpointed callback timeout inside a context", () => {
    expect(
      operationErrorName(
        op({
          id: "c",
          type: "CONTEXT",
          error: checkpointed("CallbackTimeoutError", "t"),
        }),
      ),
    ).toBe("CallbackTimeoutError");
    expect(
      operationErrorName(
        op({
          id: "c",
          type: "CONTEXT",
          error: new CallbackSubmitterError(
            "card declined",
            named("PaymentError"),
          ),
        }),
      ),
    ).toBe("PaymentError");
  });

  it("reports Error for an operation without an error object", () => {
    expect(operationErrorName(op({ id: "s", status: "FAILED" }))).toBe("Error");
  });

  describe("a callback", () => {
    const callback = (
      status: string,
      error: Error | undefined,
    ): OperationInfo =>
      op({ id: "cb", type: "CALLBACK", status: status as never, error });

    it("that timed out is CallbackTimeoutError (B11)", () => {
      expect(
        operationErrorName(
          callback(
            "TIMED_OUT",
            new CallbackTimeoutError("t", named("CallbackTimeoutError")),
          ),
        ),
      ).toBe("CallbackTimeoutError");
      expect(operationErrorName(callback("TIMED_OUT", undefined))).toBe(
        "CallbackTimeoutError",
      );
    });

    it("failed externally is named by the sender's type (B12, B13b)", () => {
      expect(
        operationErrorName(
          callback(
            "FAILED",
            new CallbackExternalError("m", named("com.acme.PaymentError")),
          ),
        ),
      ).toBe("PaymentError");
      expect(
        operationErrorName(
          callback("FAILED", new CallbackExternalError("m", named("Error"))),
        ),
      ).toBe("Error");
    });

    it("failed externally with no type is CallbackExternalError (B13)", () => {
      expect(
        operationErrorName(
          callback(
            "FAILED",
            new CallbackExternalError("m", named("CallbackExternalError")),
          ),
        ),
      ).toBe("CallbackExternalError");
      expect(
        operationErrorName(callback("FAILED", new CallbackExternalError("m"))),
      ).toBe("CallbackExternalError");
      expect(
        operationErrorName(
          callback("FAILED", new CallbackExternalError("m", named(""))),
        ),
      ).toBe("CallbackExternalError");
    });
  });
});
