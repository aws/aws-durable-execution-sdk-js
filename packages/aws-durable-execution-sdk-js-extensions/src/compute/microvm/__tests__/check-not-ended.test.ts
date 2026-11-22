import { describe, it, expect } from "vitest";
import {
  AccessDeniedException,
  ResourceNotFoundException,
} from "@aws-sdk/client-lambda-microvms";
import { MicrovmEndpointUnavailableError } from "..";
import { MicrovmStateError } from "../aws-errors";
import {
  checkNotEnded,
  MicrovmPermissionDeniedError,
  MicrovmStateCheckError,
} from "../lifecycle";
import { FakeMicrovmsClient, throwing } from "./fakes";

const state =
  (value: string, endpoint = "mvm-1.example") =>
  async () => ({ microvmId: "mvm-1", state: value, endpoint });

const options = (client: FakeMicrovmsClient) => ({
  client: client.asClient(),
  microvmId: "mvm-1",
});

const meta = { $metadata: { httpStatusCode: 403, requestId: "req-9" } };

describe("checkNotEnded", () => {
  // The service resumes a suspended MicroVM on the next request when its
  // idle policy enables auto-resume. So the check never resumes it.
  it.each(["RUNNING", "PENDING", "SUSPENDING", "SUSPENDED"])(
    "returns the endpoint of a %s MicroVM after one GetMicrovm call, and makes no other call",
    async (value) => {
      const client = new FakeMicrovmsClient();
      client.getResponses = [state(value, "new.example")];

      await expect(checkNotEnded(options(client))).resolves.toBe("new.example");
      expect(client.events).toEqual([`get:${value}`]);
    },
  );

  it.each(["TERMINATING", "TERMINATED"])(
    "throws MicrovmStateError for a %s MicroVM, with the request ID",
    async (value) => {
      const client = new FakeMicrovmsClient();
      client.getResponses = [
        async () => ({
          state: value,
          stateReason: "MaximumDuration",
          $metadata: { requestId: "req-1" },
        }),
      ];

      const error = await checkNotEnded(options(client)).catch((e) => e);
      expect(error).toBeInstanceOf(MicrovmStateError);
      expect(error.state).toBe(value);
      expect(error.message).toBe(
        `MicroVM mvm-1 is ${value}: MaximumDuration. GetMicrovm request ID: req-1.`,
      );
    },
  );

  it("throws MicrovmStateError when GetMicrovm reports the MicroVM removed", async () => {
    const client = new FakeMicrovmsClient();
    const notFound = new ResourceNotFoundException({
      message: "MicroVM not found",
      $metadata: { httpStatusCode: 404, requestId: "req-2" },
    });
    client.getResponses = [throwing(notFound)];

    const error = await checkNotEnded(options(client)).catch((e) => e);
    expect(error).toBeInstanceOf(MicrovmStateError);
    expect(error.state).toBeUndefined();
    expect(error.message).toContain("GetMicrovm request ID: req-2.");
    expect(error.cause).toBe(notFound);
  });

  it("throws MicrovmPermissionDeniedError that names lambda:GetMicrovm for a denied GetMicrovm", async () => {
    const client = new FakeMicrovmsClient();
    const denied = new AccessDeniedException({ message: "denied", ...meta });
    client.getResponses = [throwing(denied)];

    const error = await checkNotEnded(options(client)).catch((e) => e);
    expect(error).toBeInstanceOf(MicrovmPermissionDeniedError);
    expect(error.name).toBe("MicrovmPermissionDeniedError");
    expect(error.message).toBe(
      "MicroVM mvm-1 gave a sign that it does not run. GetMicrovm was denied, so the operation cannot check its state. The function's execution role needs lambda:GetMicrovm. GetMicrovm request ID: req-9.",
    );
    expect(error.cause).toBe(denied);
  });

  it("names no request ID for a denied GetMicrovm from a custom client", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = [
      throwing(
        Object.assign(new Error("denied"), {
          name: "AccessDeniedException",
          ...meta,
        }),
      ),
    ];

    const error = await checkNotEnded(options(client)).catch((e) => e);
    expect(error).toBeInstanceOf(MicrovmPermissionDeniedError);
    expect(error.message).toMatch(/needs lambda:GetMicrovm\.$/);
  });

  it.each([
    ["a connection error", () => new Error("socket hang up"), "socket hang up"],
    [
      "throttling",
      () =>
        Object.assign(new Error("slow down"), { name: "ThrottlingException" }),
      "slow down",
    ],
    // Only AccessDeniedException counts as denied. Other auth-like errors
    // keep the warn-and-retry path.
    [
      "UnrecognizedClientException",
      () =>
        Object.assign(new Error("bad token"), {
          name: "UnrecognizedClientException",
        }),
      "bad token",
    ],
  ])(
    "throws MicrovmStateCheckError for %s from GetMicrovm",
    async (_label, failure, message) => {
      const client = new FakeMicrovmsClient();
      const error = failure();
      client.getResponses = [throwing(error)];

      const thrown = await checkNotEnded(options(client)).catch((e) => e);
      expect(thrown).toBeInstanceOf(MicrovmStateCheckError);
      expect(thrown).not.toBeInstanceOf(MicrovmPermissionDeniedError);
      expect(thrown.message).toBe(message);
      expect(thrown.cause).toBe(error);
    },
  );

  it("throws MicrovmEndpointUnavailableError when no time is left for GetMicrovm", async () => {
    const client = new FakeMicrovmsClient();

    const error = await checkNotEnded({
      ...options(client),
      // 10.5 seconds leave 0.5 seconds before the invocation reserve.
      remainingTimeMs: () => 10_500,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(MicrovmEndpointUnavailableError);
    expect(error.message).toMatch(
      /^GetMicrovm for MicroVM mvm-1 did not end before the invocation reserve, after \d+ ms\.$/,
    );
    expect(client.events).toEqual([]);
  });
});
