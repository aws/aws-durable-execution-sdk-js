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
