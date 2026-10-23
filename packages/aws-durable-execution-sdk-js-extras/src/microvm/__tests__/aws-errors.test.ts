import {
  AccessDeniedException,
  ResourceNotFoundException,
  ThrottlingException,
} from "@aws-sdk/client-lambda-microvms";
import {
  addRequestId,
  MicrovmStateError,
  microvmNotFound,
  requestIdSentence,
  withOriginalMessage,
  withRequestId,
} from "../aws-errors";
import { defaultMicrovmRetryStrategy } from "../retry";
import { FakeStsServiceException } from "./fakes";

describe("requestIdSentence", () => {
  it("names the call and the request ID", () => {
    expect(
      requestIdSentence("GetMicrovm", { $metadata: { requestId: "req-1" } }),
    ).toBe("GetMicrovm request ID: req-1.");
  });

  it.each<[string, unknown]>([
    ["an empty request ID", { $metadata: { requestId: "" } }],
    ["a request ID that is not a string", { $metadata: { requestId: 123 } }],
    ["no request ID", { $metadata: {} }],
    ["no $metadata", {}],
    ["null", null],
    ["undefined", undefined],
  ])("returns an empty string for %s", (_label, source) => {
    expect(requestIdSentence("RunMicrovm", source)).toBe("");
  });
});

describe("withRequestId", () => {
  const source = { $metadata: { requestId: "req-1" } };

  it.each<[string, string]>([
    ["MicroVM not found", "MicroVM not found. RunMicrovm request ID: req-1."],
    ["Image not found.", "Image not found. RunMicrovm request ID: req-1."],
    ["Stop!", "Stop! RunMicrovm request ID: req-1."],
    ["Why?", "Why? RunMicrovm request ID: req-1."],
    ["", "RunMicrovm request ID: req-1."],
  ])("appends the sentence to %j", (message, expected) => {
    expect(withRequestId(message, "RunMicrovm", source)).toBe(expected);
  });

  it("returns the message unchanged without a request ID", () => {
    expect(withRequestId("denied", "RunMicrovm", { $metadata: {} })).toBe(
      "denied",
    );
  });
});

describe("addRequestId", () => {
  it("changes only the message of the AWS SDK error, and keeps every retry field", () => {
    const error = new ThrottlingException({
      message: "slow down",
      $metadata: { httpStatusCode: 429, requestId: "req-1" },
    });
    const fields = (e: ThrottlingException) => ({
      name: e.name,
      $fault: e.$fault,
      $retryable: e.$retryable,
      $metadata: e.$metadata,
      keys: Object.keys(e),
    });
    const before = fields(error);

    expect(addRequestId("CreateMicrovmAuthToken", error)).toBe(error);

    expect(error).toBeInstanceOf(ThrottlingException);
    expect(error.message).toBe(
      "slow down. CreateMicrovmAuthToken request ID: req-1.",
    );
    expect(fields(error)).toEqual(before);
    expect(defaultMicrovmRetryStrategy(error, 1)).toEqual({
      shouldRetry: true,
      delay: { seconds: 2 },
    });
  });

  it("keeps a non-retryable error non-retryable", () => {
    const error = new AccessDeniedException({
      message: "denied",
      $metadata: { requestId: "req-1" },
    });

    addRequestId("GetMicrovm", error);

    expect(error.message).toBe("denied. GetMicrovm request ID: req-1.");
    expect(defaultMicrovmRetryStrategy(error, 1).shouldRetry).toBe(false);
  });

  it("leaves a socket error unchanged, and keeps its code", () => {
    // A socket error does not come from the Lambda MicroVMs service.
    const error = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
      $metadata: { requestId: "req-1" },
    });

    addRequestId("RunMicrovm", error);

    expect(error.message).toBe("socket hang up");
    expect(error.code).toBe("ECONNRESET");
    expect(defaultMicrovmRetryStrategy(error, 1).shouldRetry).toBe(true);
  });

  it("names the request ID once when it sees the same error twice", () => {
    const error = new AccessDeniedException({
      message: "denied",
      $metadata: { requestId: "req-1" },
    });

    addRequestId("GetMicrovm", error);
    addRequestId("GetMicrovm", error);

    expect(error.message).toBe("denied. GetMicrovm request ID: req-1.");
  });

  it("names only the last operation when one error object is thrown for two operations", () => {
    const error = new AccessDeniedException({
      message: "denied",
      $metadata: { requestId: "req-1" },
    });

    addRequestId("CreateMicrovmAuthToken", error);
    addRequestId("TerminateMicrovm", error);

    expect(error.message).toBe("denied. TerminateMicrovm request ID: req-1.");
  });

  it("names only the last request ID when the request ID of one error object changes on each call", () => {
    const error = new ThrottlingException({
      message: "Rate exceeded",
      $metadata: { requestId: "req-1" },
    });

    for (let i = 1; i <= 3; i++) {
      error.$metadata.requestId = `req-${i}`;
      addRequestId("RunMicrovm", error);
    }

    expect(error.message).toBe("Rate exceeded. RunMicrovm request ID: req-3.");
  });

  it("restores the original message when a later call has no request ID", () => {
    const error = new ThrottlingException({
      message: "Rate exceeded",
      $metadata: { requestId: "req-1" },
    });

    addRequestId("RunMicrovm", error);
    error.$metadata.requestId = undefined;
    addRequestId("RunMicrovm", error);

    expect(error.message).toBe("Rate exceeded");
  });

  it("takes a message that other code set as the new original message", () => {
    const error = new ThrottlingException({
      message: "Rate exceeded",
      $metadata: { requestId: "req-1" },
    });

    addRequestId("RunMicrovm", error);
    error.message = "Slow down";
    error.$metadata.requestId = "req-2";
    addRequestId("RunMicrovm", error);

    expect(error.message).toBe("Slow down. RunMicrovm request ID: req-2.");
  });

  it.each<[string, () => unknown]>([
    ["a string", () => "denied"],
    [
      "an object that is not an Error",
      () => ({ message: "denied", $metadata: { requestId: "req-1" } }),
    ],
    [
      "an error of another AWS service, such as STS in a credential provider",
      () => new FakeStsServiceException("not authorized to assume role"),
    ],
    [
      "an Error with the fields of an AWS SDK error, from a custom client",
      () =>
        Object.assign(new Error("denied"), {
          name: "AccessDeniedException",
          $fault: "client",
          $metadata: { requestId: "req-1" },
        }),
    ],
    [
      "an AWS SDK error whose message is not a string",
      () =>
        Object.assign(
          new AccessDeniedException({
            message: "denied",
            $metadata: { requestId: "req-1" },
          }),
          { message: 1 },
        ),
    ],
    [
      "an AWS SDK error without a request ID",
      () => new AccessDeniedException({ message: "denied", $metadata: {} }),
    ],
  ])("returns %s unchanged", (_label, make) => {
    const value = make();
    const copy =
      typeof value === "object" ? { ...(value as object) } : undefined;
    const message = (value as { message?: unknown }).message;

    expect(addRequestId("GetMicrovm", value)).toBe(value);
    if (copy !== undefined) {
      expect({ ...(value as object) }).toEqual(copy);
      expect((value as { message?: unknown }).message).toBe(message);
    }
  });

  it("returns a frozen error unchanged, without throwing", () => {
    const error = Object.freeze(
      new AccessDeniedException({
        message: "denied",
        $metadata: { requestId: "req-1" },
      }),
    );

    expect(addRequestId("GetMicrovm", error)).toBe(error);
    expect(error.message).toBe("denied");
  });
});

describe("withOriginalMessage", () => {
  const changed = (): ThrottlingException =>
    addRequestId(
      "RunMicrovm",
      new ThrottlingException({
        message: "Rate exceeded",
        $metadata: { requestId: "req-1" },
      }),
    );
  const written = "Rate exceeded. RunMicrovm request ID: req-1.";

  it("calls fn with the original message, returns its value, and sets the message with the request ID again", () => {
    const error = changed();
    const result = { shouldRetry: true };
    const seen: string[] = [];

    expect(
      withOriginalMessage(error, () => {
        seen.push(error.message);
        return result;
      }),
    ).toBe(result);

    expect(seen).toEqual(["Rate exceeded"]);
    expect(error.message).toBe(written);
  });

  it("rethrows the exception of fn, and sets the message with the request ID again", () => {
    const error = changed();
    const failure = new Error("strategy failed");
    const seen: string[] = [];

    let thrown: unknown;
    try {
      withOriginalMessage(error, () => {
        seen.push(error.message);
        throw failure;
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBe(failure);
    expect(seen).toEqual(["Rate exceeded"]);
    expect(error.message).toBe(written);
  });

  it("restores the message with the request ID after each of several calls", () => {
    const error = changed();
    const seen: string[] = [];

    for (let i = 0; i < 3; i++) {
      withOriginalMessage(error, () => seen.push(error.message));
      expect(error.message).toBe(written);
    }

    expect(seen).toEqual(["Rate exceeded", "Rate exceeded", "Rate exceeded"]);
  });

  it("keeps the request ID in the stack when fn reads the stack first", () => {
    const error = changed();
    let stackInFn: string | undefined;

    withOriginalMessage(error, () => {
      stackInFn = error.stack;
    });

    // V8 keeps the stack text from the first read. So the read inside fn
    // must not be the first one.
    expect(stackInFn?.split("\n")[0]).toBe(`ThrottlingException: ${written}`);
    expect(error.stack?.split("\n")[0]).toBe(`ThrottlingException: ${written}`);
    expect(error.message).toBe(written);
  });

  it.each<[string, () => unknown]>([
    [
      "an AWS SDK error without a request ID",
      () =>
        addRequestId(
          "RunMicrovm",
          new ThrottlingException({ message: "Rate exceeded", $metadata: {} }),
        ),
    ],
    [
      "an error of another AWS service",
      () =>
        addRequestId(
          "RunMicrovm",
          new FakeStsServiceException("not authorized to assume role"),
        ),
    ],
    ["an Error that addRequestId never saw", () => new Error("boom")],
    ["a string", () => "boom"],
    ["undefined", () => undefined],
  ])("calls fn with %s unchanged", (_label, make) => {
    const value = make();
    const message = (value as { message?: unknown } | undefined)?.message;
    const seen: unknown[] = [];

    expect(
      withOriginalMessage(value, () => {
        seen.push((value as { message?: unknown } | undefined)?.message);
        return 1;
      }),
    ).toBe(1);

    expect(seen).toEqual([message]);
    expect((value as { message?: unknown } | undefined)?.message).toBe(message);
  });

  it("keeps a message that other code set after addRequestId", () => {
    const error = changed();
    error.message = "Slow down";
    const seen: string[] = [];

    withOriginalMessage(error, () => seen.push(error.message));

    expect(seen).toEqual(["Slow down"]);
    expect(error.message).toBe("Slow down");
  });

  it("keeps a message that fn sets", () => {
    const error = changed();

    withOriginalMessage(error, () => {
      error.message = "set by the strategy";
    });

    expect(error.message).toBe("set by the strategy");
  });

  it("calls fn with the message with the request ID when the error was frozen after addRequestId", () => {
    const error = Object.freeze(changed());
    const seen: string[] = [];

    withOriginalMessage(error, () => seen.push(error.message));

    expect(seen).toEqual([written]);
    expect(error.message).toBe(written);
  });

  it("keeps the original message, without throwing, when fn freezes the error", () => {
    const error = changed();

    expect(withOriginalMessage(error, () => Object.freeze(error))).toBe(error);

    expect(error.message).toBe("Rate exceeded");
  });
});

describe("microvmNotFound", () => {
  const removed =
    "MicroVM mvm-1 no longer exists. A MicroVM lives at most its `timeout` plus 5 minutes, and never longer than 8 hours.";

  it("names the call and the request ID of an error of the Lambda MicroVMs service", () => {
    const notFound = new ResourceNotFoundException({
      message: "gone",
      $metadata: { requestId: "req-1" },
    });

    const error = microvmNotFound("mvm-1", "CreateMicrovmAuthToken", notFound);

    expect(error).toBeInstanceOf(MicrovmStateError);
    expect(error.message).toBe(
      `${removed} CreateMicrovmAuthToken request ID: req-1.`,
    );
    expect(error.cause).toBe(notFound);
  });

  it("names no request ID for an error of another service with the same name", () => {
    const notFound = new FakeStsServiceException(
      "gone",
      { requestId: "other-req-1" },
      "ResourceNotFoundException",
    );

    const error = microvmNotFound("mvm-1", "GetMicrovm", notFound);

    expect(error.message).toBe(removed);
    expect(error.cause).toBe(notFound);
  });
});
