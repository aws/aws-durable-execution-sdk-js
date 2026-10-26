import {
  AccessDeniedException,
  ResourceNotFoundException,
} from "@aws-sdk/client-lambda-microvms";
import { MicrovmEndpointUnavailableError } from "..";
import { MicrovmStateError } from "../aws-errors";
import {
  MicrovmResumeDeniedError,
  MicrovmStateCheckError,
  resumeIfSuspended,
} from "../lifecycle";
import { FakeMicrovmsClient, throwing } from "./fakes";

const state =
  (value: string, endpoint = "mvm-1.example") =>
  async () => ({ microvmId: "mvm-1", state: value, endpoint });

const options = (client: FakeMicrovmsClient) => ({
  client: client.asClient(),
  microvmId: "mvm-1",
  maxWaitMs: 60_000,
  log: jest.fn(),
  sleep: jest.fn(async () => {}),
});

const meta = { $metadata: { httpStatusCode: 403, requestId: "req-9" } };

describe("resumeIfSuspended", () => {
  it.each(["RUNNING", "PENDING"])(
    "returns the endpoint of a %s MicroVM after one GetMicrovm call",
    async (value) => {
      const client = new FakeMicrovmsClient();
      client.getResponses = [state(value, "new.example")];

      await expect(resumeIfSuspended(options(client))).resolves.toBe(
        "new.example",
      );
      expect(client.events).toEqual([`get:${value}`]);
    },
  );

  it.each(["SUSPENDED", "SUSPENDING"])(
    "resumes a %s MicroVM once, and waits for RUNNING",
    async (value) => {
      const client = new FakeMicrovmsClient();
      client.getResponses = [
        state(value),
        // The MicroVM stays SUSPENDED while its resume hook runs. A resume
        // was sent, so the wait does not resume again.
        state("SUSPENDED"),
        state("RUNNING", "resumed.example"),
      ];
      const opts = options(client);

      await expect(resumeIfSuspended(opts)).resolves.toBe("resumed.example");
      expect(client.events).toEqual([
        `get:${value}`,
        "resume",
        "get:SUSPENDED",
        "get:RUNNING",
      ]);
      expect(opts.log).toHaveBeenCalledWith("resuming MicroVM", {
        state: value,
      });
    },
  );

  it("does not return PENDING after its resume", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = [
      state("SUSPENDED"),
      state("PENDING"),
      state("RUNNING"),
    ];

    await expect(resumeIfSuspended(options(client))).resolves.toBe(
      "mvm-1.example",
    );
    expect(client.events).toEqual([
      "get:SUSPENDED",
      "resume",
      "get:PENDING",
      "get:RUNNING",
    ]);
  });

  it("keeps polling when ResumeMicrovm reports a transition in progress", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = [state("SUSPENDED"), state("RUNNING")];
    client.resumeResponses = [
      throwing(Object.assign(new Error("busy"), { name: "ConflictException" })),
    ];

    await expect(resumeIfSuspended(options(client))).resolves.toBe(
      "mvm-1.example",
    );
  });

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

      const error = await resumeIfSuspended(options(client)).catch((e) => e);
      expect(error).toBeInstanceOf(MicrovmStateError);
      expect(error.state).toBe(value);
      expect(error.message).toBe(
        `MicroVM mvm-1 is ${value}: MaximumDuration. GetMicrovm request ID: req-1.`,
      );
      expect(client.events).not.toContain("resume");
    },
  );

  it.each<["GetMicrovm" | "ResumeMicrovm"]>([
    ["GetMicrovm"],
    ["ResumeMicrovm"],
  ])(
    "throws MicrovmStateError when %s reports the MicroVM removed",
    async (operation) => {
      const client = new FakeMicrovmsClient();
      const notFound = new ResourceNotFoundException({
        message: "MicroVM not found",
        $metadata: { httpStatusCode: 404, requestId: "req-2" },
      });
      if (operation === "GetMicrovm") {
        client.getResponses = [throwing(notFound)];
      } else {
        client.getResponses = [state("SUSPENDED")];
        client.resumeResponses = [throwing(notFound)];
      }

      const error = await resumeIfSuspended(options(client)).catch((e) => e);
      expect(error).toBeInstanceOf(MicrovmStateError);
      expect(error.state).toBeUndefined();
      expect(error.message).toContain(`${operation} request ID: req-2.`);
      expect(error.cause).toBe(notFound);
    },
  );

  it("throws MicrovmStateCheckError with denied set for a denied GetMicrovm", async () => {
    const client = new FakeMicrovmsClient();
    const denied = new AccessDeniedException({ message: "denied", ...meta });
    client.getResponses = [throwing(denied)];

    const error = await resumeIfSuspended(options(client)).catch((e) => e);
    expect(error).toBeInstanceOf(MicrovmStateCheckError);
    expect(error.denied).toBe(true);
    expect(error.message).toBe("denied. GetMicrovm request ID: req-9.");
    expect(error.cause).toBe(denied);
  });

  it("throws MicrovmStateCheckError without denied for another GetMicrovm failure", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = [throwing(new Error("socket hang up"))];

    const error = await resumeIfSuspended(options(client)).catch((e) => e);
    expect(error).toBeInstanceOf(MicrovmStateCheckError);
    expect(error.denied).toBe(false);
    expect(error.message).toBe("socket hang up");
  });

  it("throws MicrovmResumeDeniedError that names lambda:ResumeMicrovm for a denied ResumeMicrovm", async () => {
    const client = new FakeMicrovmsClient();
    const denied = new AccessDeniedException({ message: "denied", ...meta });
    client.getResponses = [state("SUSPENDED")];
    client.resumeResponses = [throwing(denied)];

    const error = await resumeIfSuspended(options(client)).catch((e) => e);
    expect(error).toBeInstanceOf(MicrovmResumeDeniedError);
    expect(error.name).toBe("MicrovmResumeDeniedError");
    expect(error.message).toBe(
      "MicroVM mvm-1 is SUSPENDED. ResumeMicrovm was denied, so the operation cannot resume it. The function's execution role needs lambda:ResumeMicrovm. ResumeMicrovm request ID: req-9.",
    );
    expect(error.cause).toBe(denied);
  });

  it("names no request ID for a denied ResumeMicrovm from a custom client", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = [state("SUSPENDING")];
    client.resumeResponses = [
      throwing(
        Object.assign(new Error("denied"), {
          name: "AccessDeniedException",
          ...meta,
        }),
      ),
    ];

    const error = await resumeIfSuspended(options(client)).catch((e) => e);
    expect(error).toBeInstanceOf(MicrovmResumeDeniedError);
    expect(error.message).toMatch(/needs lambda:ResumeMicrovm\.$/);
  });

  it("rethrows another ResumeMicrovm error with its class", async () => {
    const client = new FakeMicrovmsClient();
    const throttled = Object.assign(new Error("slow down"), {
      name: "ThrottlingException",
    });
    client.getResponses = [state("SUSPENDED")];
    client.resumeResponses = [throwing(throttled)];

    await expect(resumeIfSuspended(options(client))).rejects.toBe(throttled);
  });

  it("throws MicrovmEndpointUnavailableError when no time is left for GetMicrovm", async () => {
    const client = new FakeMicrovmsClient();

    const error = await resumeIfSuspended({
      ...options(client),
      // 10.5 seconds leave 0.5 seconds before the invocation reserve.
      remainingTimeMs: () => 10_500,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(MicrovmEndpointUnavailableError);
    expect(error.message).toMatch(
      /^MicroVM mvm-1 did not reach RUNNING in \d+ ms\. Last state: unknown\.$/,
    );
    expect(client.events).toEqual([]);
  });

  it("throws MicrovmEndpointUnavailableError when no time is left for ResumeMicrovm", async () => {
    const client = new FakeMicrovmsClient();
    const now = jest.spyOn(Date, "now");
    let clock = 1_000_000;
    now.mockImplementation(() => clock);
    try {
      client.getResponses = [
        async () => {
          // GetMicrovm takes 9.5 of the 10 seconds before the reserve.
          clock += 9_500;
          return { state: "SUSPENDED" };
        },
      ];

      const error = await resumeIfSuspended({
        ...options(client),
        remainingTimeMs: () => 20_000,
      }).catch((e) => e);
      expect(error).toBeInstanceOf(MicrovmEndpointUnavailableError);
      expect(client.events).toEqual(["get:SUSPENDED"]);
    } finally {
      now.mockRestore();
    }
  });

  it("gives the wait after the resume what remains of maxWaitMs", async () => {
    const client = new FakeMicrovmsClient();
    const now = jest.spyOn(Date, "now");
    let clock = 1_000_000;
    now.mockImplementation(() => clock);
    try {
      client.getResponses = [
        async () => {
          clock += 900;
          return { state: "SUSPENDED" };
        },
      ];
      // The MicroVM never reaches RUNNING.
      client.microvmState = "SUSPENDED";
      client.resumeResponses = [async () => ({})];
      const opts = {
        ...options(client),
        maxWaitMs: 1_000,
        sleep: jest.fn(async (ms: number) => {
          clock += ms;
        }),
      };

      const error = await resumeIfSuspended(opts).catch((e) => e);
      expect(error).toBeInstanceOf(MicrovmEndpointUnavailableError);
      expect(error.message).toContain("Last state: SUSPENDED.");
      // 100 ms remain after the first GetMicrovm call. So the wait polls once
      // and sleeps for none of its 250-millisecond delays.
      expect(opts.sleep).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });
});
