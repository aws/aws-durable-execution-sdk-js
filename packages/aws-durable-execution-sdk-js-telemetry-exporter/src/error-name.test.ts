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
import { ErrorNameResolver, reduceTypeName } from "./error-name";

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

const byId = (...ops: OperationInfo[]): Record<string, OperationInfo> =>
  Object.fromEntries(ops.map((o) => [o.id, o]));

describe("ErrorNameResolver.executionErrorName", () => {
  const resolve = (error: Error, ops: OperationInfo[] = []) =>
    new ErrorNameResolver(byId(...ops)).executionErrorName(error);

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
  });

  describe("unwraps at most 16 wrappers (rule 3)", () => {
    /**
     * `count` wrappers around a PaymentError. The innermost wrapper is a
     * ChildContextError and the others are StepErrors, so the name reported
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
    expect(resolve(new CallbackTimeoutError("Callback timed out"))).toBe(
      "CallbackTimeoutError",
    );
    // Inside a child context the timeout is rebuilt from the checkpoint.
    expect(
      resolve(
        new ChildContextError(
          "Callback timed out",
          checkpointed("CallbackTimeoutError", "Callback timed out"),
        ),
      ),
    ).toBe("CallbackTimeoutError");
  });

  it("names an external callback failure by the sender's type, or the SDK class without one (B12, B13)", () => {
    expect(
      resolve(
        new CallbackExternalError("card declined", named("PaymentError")),
      ),
    ).toBe("PaymentError");
    expect(
      resolve(new CallbackExternalError("card declined", named("Error"))),
    ).toBe("CallbackExternalError");
    expect(resolve(new CallbackExternalError("card declined", named("")))).toBe(
      "CallbackExternalError",
    );
    expect(resolve(new CallbackExternalError("Callback failed"))).toBe(
      "CallbackExternalError",
    );
  });

  it("names an invoke failure by the invoked function's error type (B9)", () => {
    expect(
      resolve(new InvokeError("card declined", named("PaymentError"))),
    ).toBe("PaymentError");
  });

  describe("an invoke failure whose cause has no type (B9, rule 8)", () => {
    // The failed invoke operation, rebuilt from its checkpoint, keeps the type.
    const invokeOp = (
      partial: Partial<OperationInfo> & { id: string },
    ): OperationInfo =>
      op({
        name: partial.id,
        type: "CHAINED_INVOKE",
        status: "FAILED",
        error: checkpointed("PaymentError"),
        ...partial,
      });

    it.each([
      ["named Error", named("Error")],
      ["with a blank name", named("")],
    ])(
      "takes the name from the failed invoke operation when the cause is %s",
      (_label, cause) => {
        expect(
          resolve(new InvokeError("card declined", cause), [
            invokeOp({ id: "pay" }),
          ]),
        ).toBe("PaymentError");
      },
    );

    it("keeps a typed cause as it is (plain unwrap), even when an operation disagrees", () => {
      expect(
        resolve(new InvokeError("card declined", named("PaymentError")), [
          invokeOp({ id: "pay", error: checkpointed("RefundError") }),
        ]),
      ).toBe("PaymentError");
    });

    it("does not guess between same-message invoke operations with different types (rule 9)", () => {
      const ops = [
        invokeOp({
          id: "other",
          error: checkpointed("RefundError", "other message"),
        }),
        op({ id: "child", name: "child", type: "CONTEXT", status: "FAILED" }),
        invokeOp({
          id: "deep",
          parentId: "child",
          error: checkpointed("DeepError"),
        }),
        invokeOp({
          id: "early",
          endTimestamp: new Date(1),
          error: checkpointed("EarlyError"),
        }),
        invokeOp({ id: "late", endTimestamp: new Date(2) }),
      ];
      const error = new ChildContextError(
        "card declined",
        new InvokeError("card declined", named("Error")),
      );
      // "early" and "late" are both shallowest and disagree.
      expect(resolve(error, ops)).toBe("InvokeError");
      // Without "early", the shallowest match is unique.
      expect(
        resolve(
          error,
          ops.filter((o) => o.id !== "early"),
        ),
      ).toBe("PaymentError");
      // Agreeing candidates are not ambiguous.
      expect(
        resolve(error, [
          invokeOp({ id: "a", endTimestamp: new Date(1) }),
          invokeOp({ id: "b", endTimestamp: new Date(2) }),
        ]),
      ).toBe("PaymentError");
    });

    it("ignores operations that are not chained invokes", () => {
      expect(
        resolve(new InvokeError("card declined", named("Error")), [
          op({
            id: "charge",
            name: "charge",
            status: "FAILED",
            error: checkpointed("PaymentError"),
          }),
        ]),
      ).toBe("InvokeError");
    });

    it("reports InvokeError, never Error, when no failed invoke operation matches", () => {
      expect(resolve(new InvokeError("card declined", named("Error")))).toBe(
        "InvokeError",
      );
      expect(
        resolve(new InvokeError("card declined", named("Error")), [
          invokeOp({ id: "pay", error: checkpointed("PaymentError", "other") }),
        ]),
      ).toBe("InvokeError");
    });

    it("does not treat an untyped cause of another wrapper as an invoke failure", () => {
      expect(
        resolve(new StepError("card declined", named("Error")), [
          invokeOp({ id: "pay" }),
        ]),
      ).toBe("Error");
    });
  });

  it("reduces the user's type name and reports Error for a blank one", () => {
    expect(resolve(new StepError("x", named("a.b.Outer$PaymentError")))).toBe(
      "PaymentError",
    );
    expect(resolve(new StepError("x", named("Payment$Error")))).toBe("Error");
    expect(resolve(new StepError("x", named("   ")))).toBe("Error");
  });

  it("names a lost user type after the failed operation it came from (B4, rule 8)", () => {
    // runInChildContext around a failed step: the child is checkpointed as
    // StepError, so the execution error's chain ends at a cause named StepError.
    const ops = [
      op({
        id: "child",
        name: "child",
        type: "CONTEXT",
        status: "FAILED",
        error: checkpointed("StepError"),
      }),
      op({
        id: "charge",
        name: "charge",
        parentId: "child",
        status: "FAILED",
        error: checkpointed("PaymentError"),
      }),
    ];
    const error = new ChildContextError(
      "card declined",
      checkpointed("StepError"),
    );
    expect(resolve(error, ops)).toBe("PaymentError");
  });

  it("prefers the shallowest matching operation, and does not guess among them (rule 9)", () => {
    const ops = [
      op({
        id: "early",
        name: "early",
        type: "CONTEXT",
        status: "FAILED",
        endTimestamp: new Date(1),
        error: checkpointed("StepError"),
      }),
      op({
        id: "e1",
        name: "e1",
        parentId: "early",
        status: "FAILED",
        error: checkpointed("RefundError"),
      }),
      op({
        id: "late",
        name: "late",
        type: "CONTEXT",
        status: "FAILED",
        endTimestamp: new Date(2),
        error: checkpointed("StepError"),
      }),
      op({
        id: "l1",
        name: "l1",
        parentId: "late",
        status: "FAILED",
        error: checkpointed("PaymentError"),
      }),
    ];
    const error = new ChildContextError(
      "card declined",
      checkpointed("StepError"),
    );
    // "early" (RefundError) and "late" (PaymentError) disagree: the wrapper.
    expect(resolve(error, ops)).toBe("StepError");
    // The same types agree: no guess is needed.
    const agreeing = ops.map((o) =>
      o.id === "e1" ? { ...o, error: checkpointed("PaymentError") } : o,
    );
    expect(resolve(error, agreeing)).toBe("PaymentError");
    // A deeper match never competes with a shallower one.
    expect(
      resolve(error, [
        ...ops.slice(2),
        op({
          id: "deep",
          name: "deep",
          parentId: "l1",
          type: "CONTEXT",
          status: "FAILED",
          error: checkpointed("StepError"),
        }),
      ]),
    ).toBe("PaymentError");
  });

  it("keeps the checkpointed type when the failed operation is not visible", () => {
    expect(
      resolve(
        new ChildContextError("card declined", checkpointed("StepError")),
      ),
    ).toBe("StepError");
  });
});

describe("ErrorNameResolver.operationErrorName", () => {
  const resolve = (target: string, ops: OperationInfo[]) => {
    const all = byId(...ops);
    return new ErrorNameResolver(all).operationErrorName(all[target]);
  };

  it("names a step failure by the user's type (B1)", () => {
    expect(
      resolve("s", [
        op({ id: "s", status: "FAILED", error: checkpointed("PaymentError") }),
      ]),
    ).toBe("PaymentError");
  });

  it("names a child context whose step failed after that step (B4, B6, B10)", () => {
    const ops = [
      op({ id: "map", type: "CONTEXT", subType: "Map", status: "SUCCEEDED" }),
      op({
        id: "item",
        type: "CONTEXT",
        parentId: "map",
        status: "FAILED",
        error: checkpointed("StepError"),
      }),
      op({
        id: "inner",
        type: "CONTEXT",
        parentId: "item",
        status: "FAILED",
        error: checkpointed("StepError"),
      }),
      op({
        id: "unrelated",
        parentId: "item",
        status: "FAILED",
        error: checkpointed("OtherError", "other"),
      }),
      op({
        id: "step",
        parentId: "inner",
        status: "FAILED",
        error: checkpointed("PaymentError"),
      }),
    ];
    expect(resolve("item", ops)).toBe("PaymentError");
    expect(resolve("inner", ops)).toBe("PaymentError");
  });

  it("does not guess between failed children with the same message (rule 9, B20, B21)", () => {
    const ops = [
      op({
        id: "item",
        type: "CONTEXT",
        status: "FAILED",
        endTimestamp: new Date(10),
        error: checkpointed("StepError"),
      }),
      op({
        id: "s0",
        parentId: "item",
        status: "FAILED",
        endTimestamp: new Date(5),
        error: checkpointed("PaymentError"),
      }),
      op({
        id: "s1",
        parentId: "item",
        status: "FAILED",
        endTimestamp: new Date(6),
        error: checkpointed("FraudError"),
      }),
    ];
    expect(resolve("item", ops)).toBe("StepError");
    expect(resolve("s0", ops)).toBe("PaymentError");
    expect(resolve("s1", ops)).toBe("FraudError");
  });

  it("prefers children that ended no later than the failed parent (R2)", () => {
    const ops = [
      op({
        id: "child",
        type: "CONTEXT",
        status: "FAILED",
        endTimestamp: new Date(10),
        error: checkpointed("StepError"),
      }),
      op({
        id: "fast",
        parentId: "child",
        status: "FAILED",
        endTimestamp: new Date(5),
        error: checkpointed("TypeError"),
      }),
      op({
        id: "slow",
        parentId: "child",
        status: "FAILED",
        endTimestamp: new Date(20),
        error: checkpointed("PaymentError"),
      }),
    ];
    expect(resolve("child", ops)).toBe("TypeError");
  });

  describe("a promise combinator whose failed promise is a sibling (R1, B19)", () => {
    const combinator = (partial: Partial<OperationInfo> = {}) =>
      op({
        id: "combo",
        name: "combo",
        type: "CONTEXT",
        status: "FAILED",
        startTimestamp: new Date(10),
        endTimestamp: new Date(30),
        error: checkpointed("StepError"),
        ...partial,
      });
    const step = (
      id: string,
      type: string,
      partial: Partial<OperationInfo> = {},
    ) =>
      op({
        id,
        name: id,
        status: "FAILED",
        startTimestamp: new Date(10),
        endTimestamp: new Date(20),
        error: checkpointed(type),
        ...partial,
      });

    it("names the combinator after the failed sibling", () => {
      expect(resolve("combo", [combinator(), step("s1", "PaymentError")])).toBe(
        "PaymentError",
      );
      // Nested in a parent context, siblings share its parentId.
      expect(
        resolve("combo", [
          op({ id: "p", type: "CONTEXT", status: "STARTED" }),
          combinator({ parentId: "p" }),
          step("s1", "PaymentError", { parentId: "p" }),
          step("other", "FraudError"),
        ]),
      ).toBe("PaymentError");
    });

    it("ignores a sibling that started before the combinator (an earlier, handled failure)", () => {
      expect(
        resolve("combo", [
          combinator(),
          step("s1", "PaymentError", {
            startTimestamp: new Date(1),
            endTimestamp: new Date(2),
          }),
        ]),
      ).toBe("StepError");
    });

    it("ignores siblings whose name is itself a wrapper type", () => {
      expect(
        resolve("combo", [
          combinator(),
          op({
            id: "c2",
            type: "CONTEXT",
            status: "FAILED",
            startTimestamp: new Date(10),
            endTimestamp: new Date(20),
            error: checkpointed("StepError"),
          }),
        ]),
      ).toBe("StepError");
    });

    it("does not guess between siblings with different types (rule 9)", () => {
      expect(
        resolve("combo", [
          combinator(),
          step("s1", "PaymentError"),
          step("s2", "FraudError"),
        ]),
      ).toBe("StepError");
      // A sibling that ended after the combinator is not a candidate.
      expect(
        resolve("combo", [
          combinator(),
          step("s1", "PaymentError"),
          step("s2", "FraudError", { endTimestamp: new Date(40) }),
        ]),
      ).toBe("PaymentError");
    });

    it("prefers a failed child to a sibling", () => {
      expect(
        resolve("combo", [
          combinator(),
          step("inside", "PaymentError", { parentId: "combo" }),
          step("s1", "FraudError"),
        ]),
      ).toBe("PaymentError");
    });
  });

  describe("descends at most 16 operation levels", () => {
    /** `contexts` nested failed contexts around a failed step. */
    const nested = (contexts: number): OperationInfo[] => {
      const ops: OperationInfo[] = [];
      for (let i = 0; i < contexts; i++) {
        ops.push(
          op({
            id: `c${i}`,
            type: "CONTEXT",
            parentId: i === 0 ? undefined : `c${i - 1}`,
            status: "FAILED",
            error: checkpointed("StepError"),
          }),
        );
      }
      ops.push(
        op({
          id: "step",
          parentId: `c${contexts - 1}`,
          status: "FAILED",
          error: checkpointed("PaymentError"),
        }),
      );
      return ops;
    };

    it.each([
      [1, "PaymentError"],
      // 16 levels: 15 contexts and the step.
      [15, "PaymentError"],
      [16, "StepError"],
      [17, "StepError"],
    ])("%i contexts above the step -> %s", (contexts, expected) => {
      expect(resolve("c0", nested(contexts))).toBe(expected);
    });
  });

  it("keeps the checkpointed type when no failed child matches", () => {
    expect(
      resolve("c", [
        op({
          id: "c",
          type: "CONTEXT",
          status: "FAILED",
          error: checkpointed("StepError"),
        }),
      ]),
    ).toBe("StepError");
  });

  it("survives a parent cycle", () => {
    const ops = [
      op({
        id: "a",
        type: "CONTEXT",
        parentId: "b",
        status: "FAILED",
        error: checkpointed("StepError"),
      }),
      op({
        id: "b",
        type: "CONTEXT",
        parentId: "a",
        status: "FAILED",
        error: checkpointed("StepError"),
      }),
    ];
    expect(resolve("a", ops)).toBe("StepError");
  });

  it("names a timed-out callback CallbackTimeoutError (B11)", () => {
    expect(
      resolve("cb", [
        op({
          id: "cb",
          type: "CALLBACK",
          status: "TIMED_OUT",
          error: checkpointed(undefined, "Callback timed out"),
        }),
      ]),
    ).toBe("CallbackTimeoutError");
  });

  it("names an external callback failure by the sender's type, or the SDK class without one (B12, B13)", () => {
    const failedCallback = (ErrorType: string | undefined) => [
      op({
        id: "cb",
        type: "CALLBACK",
        status: "FAILED",
        error: checkpointed(ErrorType),
      }),
    ];
    expect(resolve("cb", failedCallback("PaymentError"))).toBe("PaymentError");
    expect(resolve("cb", failedCallback("com.acme.PaymentError"))).toBe(
      "PaymentError",
    );
    expect(resolve("cb", failedCallback(undefined))).toBe(
      "CallbackExternalError",
    );
    expect(resolve("cb", failedCallback(""))).toBe("CallbackExternalError");
  });

  it("does not unwrap a checkpointed callback timeout or submitter wrapper inside a context", () => {
    expect(
      resolve("c", [
        op({
          id: "c",
          type: "CONTEXT",
          status: "FAILED",
          error: checkpointed("CallbackTimeoutError", "t"),
        }),
      ]),
    ).toBe("CallbackTimeoutError");
    // A live wrapper with a user cause is unwrapped.
    expect(
      resolve("c", [
        op({
          id: "c",
          type: "CONTEXT",
          status: "FAILED",
          error: new CallbackSubmitterError(
            "card declined",
            named("PaymentError"),
          ),
        }),
      ]),
    ).toBe("PaymentError");
  });
});
