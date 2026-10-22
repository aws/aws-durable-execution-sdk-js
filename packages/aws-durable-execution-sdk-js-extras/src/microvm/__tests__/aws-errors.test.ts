import {
  AccessDeniedException,
  ThrottlingException,
} from "@aws-sdk/client-lambda-microvms";
import { addRequestId, requestIdSentence, withRequestId } from "../aws-errors";
import { defaultMicrovmRetryStrategy } from "../retry";

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

  it("keeps the code of a socket error", () => {
    const error = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
      $metadata: { requestId: "req-1" },
    });

    addRequestId("RunMicrovm", error);

    expect(error.code).toBe("ECONNRESET");
    expect(defaultMicrovmRetryStrategy(error, 1).shouldRetry).toBe(true);
  });

  it("appends the sentence once when it sees the same error twice", () => {
    const error = new AccessDeniedException({
      message: "denied",
      $metadata: { requestId: "req-1" },
    });

    addRequestId("GetMicrovm", error);
    addRequestId("GetMicrovm", error);

    expect(error.message).toBe("denied. GetMicrovm request ID: req-1.");
  });

  it.each<[string, () => unknown]>([
    ["a string", () => "denied"],
    [
      "an object that is not an Error",
      () => ({ message: "denied", $metadata: { requestId: "req-1" } }),
    ],
    [
      "an Error whose message is not a string",
      () =>
        Object.assign(new Error(), {
          message: 1,
          $metadata: { requestId: "req-1" },
        }),
    ],
    [
      "an Error without a request ID",
      () => Object.assign(new Error("denied"), { $metadata: {} }),
    ],
  ])("returns %s unchanged", (_label, make) => {
    const value = make();
    const copy =
      typeof value === "object" ? { ...(value as object) } : undefined;

    expect(addRequestId("GetMicrovm", value)).toBe(value);
    if (copy !== undefined) {
      expect({ ...(value as object) }).toEqual(copy);
    }
  });

  it("returns a frozen error unchanged, without throwing", () => {
    const error = Object.freeze(
      Object.assign(new Error("denied"), {
        $metadata: { requestId: "req-1" },
      }),
    );

    expect(addRequestId("GetMicrovm", error)).toBe(error);
    expect(error.message).toBe("denied");
  });
});
