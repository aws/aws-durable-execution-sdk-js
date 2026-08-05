import {
  DurableExecutionClientError,
  DurableExecutionClientErrorScope,
  isDurableExecutionClientError,
} from "./durable-execution-client-error";

describe("DurableExecutionClientError", () => {
  it("defaults to invocation scope so an unclassified failure is treated as transient", () => {
    const error = new DurableExecutionClientError("boom");

    expect(error.scope).toBe(DurableExecutionClientErrorScope.INVOCATION);
  });

  it("carries the requested scope", () => {
    const error = new DurableExecutionClientError("boom", {
      scope: DurableExecutionClientErrorScope.EXECUTION,
    });

    expect(error.scope).toBe(DurableExecutionClientErrorScope.EXECUTION);
  });

  it("is a real Error with the message and name preserved", () => {
    const error = new DurableExecutionClientError("checkpoint rejected");

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("checkpoint rejected");
    expect(error.name).toBe("DurableExecutionClientError");
    expect(error.stack).toBeDefined();
  });

  it("preserves the underlying error as the cause", () => {
    const cause = new Error("socket hang up");
    const error = new DurableExecutionClientError("checkpoint failed", {
      cause,
    });

    expect(error.cause).toBe(cause);
  });

  it("omits cause when none was supplied", () => {
    expect(new DurableExecutionClientError("boom").cause).toBeUndefined();
  });
});

describe("isDurableExecutionClientError", () => {
  it("recognizes the error", () => {
    expect(
      isDurableExecutionClientError(new DurableExecutionClientError("boom")),
    ).toBe(true);
  });

  it("recognizes an equivalent error from a separately bundled copy of the class", () => {
    // A transport bundled apart from the SDK holds its own copy of the class, so
    // `instanceof` would fail. The marker is what makes it recognizable.
    const fromOtherBundle = Object.assign(new Error("boom"), {
      isDurableExecutionClientError: true,
      scope: DurableExecutionClientErrorScope.EXECUTION,
    });

    expect(isDurableExecutionClientError(fromOtherBundle)).toBe(true);
  });

  it.each([
    ["a plain error", new Error("boom")],
    ["undefined", undefined],
    ["null", null],
    ["a string", "boom"],
    ["a marker-bearing non-error", { isDurableExecutionClientError: true }],
  ])("does not recognize %s", (_label, value) => {
    expect(isDurableExecutionClientError(value)).toBe(false);
  });

  it("does not recognize the marker with an unrecognized scope", () => {
    // A malformed value must fall through to normal handling rather than being
    // acted on as if it carried a classification.
    const malformed = Object.assign(new Error("boom"), {
      isDurableExecutionClientError: true,
      scope: "SOMETHING_ELSE",
    });

    expect(isDurableExecutionClientError(malformed)).toBe(false);
  });

  it("does not recognize the marker with a missing scope", () => {
    const malformed = Object.assign(new Error("boom"), {
      isDurableExecutionClientError: true,
    });

    expect(isDurableExecutionClientError(malformed)).toBe(false);
  });
});
