import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CallbackExternalError,
  CallbackSubmitterError,
  CallbackTimeoutError,
  ChildContextError,
  DurableOperationError,
  InvokeError,
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
    expect(vectors.version).toBe(1);
    expect(vectors.reduce.length).toBeGreaterThanOrEqual(15);
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

  it("stops after 16 wrappers", () => {
    let error: Error = named("PaymentError");
    for (let i = 0; i < 17; i++) error = new StepError("x", error);
    // 16 unwraps leave the innermost wrapper, which reports its own name.
    expect(resolve(error)).toBe("StepError");
    let shorter: Error = named("PaymentError");
    for (let i = 0; i < 16; i++) shorter = new StepError("x", shorter);
    expect(resolve(shorter)).toBe("PaymentError");
  });

  it("stops at a cycle", () => {
    const a = new StepError("x");
    const b = new ChildContextError("x", a);
    a.cause = b;
    expect(["StepError", "ChildContextError"]).toContain(resolve(b));
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

    it("finds the invoke operation through outer wrappers, by message, shallowest then latest", () => {
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
      expect(resolve(error, ops)).toBe("PaymentError");
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

  it("prefers the shallowest matching operation, then the latest to end", () => {
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
    expect(
      resolve(
        new ChildContextError("card declined", checkpointed("StepError")),
        ops,
      ),
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
