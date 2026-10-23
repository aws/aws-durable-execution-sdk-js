import {
  AccessDeniedException,
  ResourceNotFoundException,
} from "@aws-sdk/client-lambda-microvms";
import { MicrovmEndpointUnavailableError } from "..";
import { MicrovmStateError } from "../aws-errors";
import { ensureRunning } from "../lifecycle";
import { FakeMicrovmsClient, throwing } from "./fakes";

const state =
  (value: string, endpoint = "mvm-1.example") =>
  async () => ({
    microvmId: "mvm-1",
    state: value,
    endpoint,
  });

const options = (client: FakeMicrovmsClient) => {
  const log = jest.fn();
  const sleep = jest.fn(async () => {});
  return {
    client: client.asClient(),
    microvmId: "mvm-1",
    maxWaitMs: 120_000,
    log,
    sleep,
  };
};

describe("ensureRunning", () => {
  it("returns the current endpoint of a running MicroVM", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = [state("RUNNING", "new-endpoint.example")];

    await expect(ensureRunning(options(client))).resolves.toBe(
      "new-endpoint.example",
    );
    expect(client.events).toEqual(["get:RUNNING"]);
  });

  it("waits for a suspend in progress, then resumes once", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = [
      state("SUSPENDING"),
      state("SUSPENDED"),
      // The MicroVM stays SUSPENDED while its resume hook runs.
      state("SUSPENDED"),
      state("RUNNING"),
    ];
    const opts = options(client);

    await expect(ensureRunning(opts)).resolves.toBe("mvm-1.example");
    expect(client.events).toEqual([
      "get:SUSPENDING",
      "get:SUSPENDED",
      "resume",
      "get:SUSPENDED",
      "get:RUNNING",
    ]);
    expect(opts.sleep).toHaveBeenCalledTimes(3);
    expect(opts.log).toHaveBeenCalledWith("MicroVM resumed", expect.anything());
  });

  it("keeps polling when ResumeMicrovm reports a transition in progress", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = [state("SUSPENDED"), state("RUNNING")];
    client.resumeResponses = [
      throwing(Object.assign(new Error("busy"), { name: "ConflictException" })),
    ];

    await expect(ensureRunning(options(client))).resolves.toBe("mvm-1.example");
  });

  it("returns at once for a new MicroVM that is still booting", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = [state("PENDING")];
    const opts = options(client);

    await expect(ensureRunning(opts)).resolves.toBe("mvm-1.example");
    expect(client.events).toEqual(["get:PENDING"]);
    expect(opts.sleep).not.toHaveBeenCalled();
  });

  it("throws MicrovmStateError for a terminated MicroVM", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = [
      async () => ({ state: "TERMINATED", stateReason: "MaximumDuration" }),
    ];

    const error = await ensureRunning(options(client)).catch((e) => e);
    expect(error).toBeInstanceOf(MicrovmStateError);
    expect(error.state).toBe("TERMINATED");
    expect(error.message).toContain("MaximumDuration");
  });

  it("throws MicrovmStateError when the MicroVM no longer exists", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = [
      throwing(
        Object.assign(new Error("MicroVM not found"), {
          name: "ResourceNotFoundException",
        }),
      ),
    ];

    const error = await ensureRunning(options(client)).catch((e) => e);
    expect(error).toBeInstanceOf(MicrovmStateError);
    expect(error.state).toBeUndefined();
    expect(error.message).toContain("`timeout` plus 5 minutes");
  });

  it("throws MicrovmStateError when the MicroVM is removed before ResumeMicrovm", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = [state("SUSPENDED")];
    client.resumeResponses = [
      throwing(
        Object.assign(new Error("MicroVM not found"), {
          name: "ResourceNotFoundException",
        }),
      ),
    ];
    const opts = options(client);

    const error = await ensureRunning(opts).catch((e) => e);
    expect(error).toBeInstanceOf(MicrovmStateError);
    expect(error.state).toBeUndefined();
    expect(error.message).toBe(
      "MicroVM mvm-1 no longer exists. A MicroVM lives at most its `timeout` plus 5 minutes, and never longer than 8 hours.",
    );
    // The function stops at once. It does not poll a removed MicroVM.
    expect(client.events).toEqual(["get:SUSPENDED", "resume"]);
    expect(opts.sleep).not.toHaveBeenCalled();
  });

  const removedMessage =
    "MicroVM mvm-1 no longer exists. A MicroVM lives at most its `timeout` plus 5 minutes, and never longer than 8 hours.";

  /** Makes the named call answer `error`. GetMicrovm first reports SUSPENDED for ResumeMicrovm. */
  const answerNotFound = (
    client: FakeMicrovmsClient,
    operation: "GetMicrovm" | "ResumeMicrovm",
    error: Error,
  ): void => {
    if (operation === "GetMicrovm") {
      client.getResponses = [throwing(error)];
    } else {
      client.getResponses = [state("SUSPENDED")];
      client.resumeResponses = [throwing(error)];
    }
  };

  describe.each<"GetMicrovm" | "ResumeMicrovm">([
    "GetMicrovm",
    "ResumeMicrovm",
  ])("when %s reports that the MicroVM no longer exists", (operation) => {
    it("names the call and its request ID in the message, and keeps the AWS SDK error as the cause", async () => {
      const client = new FakeMicrovmsClient();
      const notFound = new ResourceNotFoundException({
        message: "MicroVM not found",
        $metadata: { httpStatusCode: 404, requestId: "req-123" },
        resourceType: "MicroVM",
        resourceId: "mvm-1",
      });
      answerNotFound(client, operation, notFound);

      const error = await ensureRunning(options(client)).catch((e) => e);
      expect(error).toBeInstanceOf(MicrovmStateError);
      expect(error.state).toBeUndefined();
      expect(error.message).toBe(
        `${removedMessage} ${operation} request ID: req-123.`,
      );
      expect(error.cause).toBe(notFound);
    });

    it.each<[string, Record<string, unknown> | undefined]>([
      ["no request ID", {}],
      ["an empty request ID", { requestId: "" }],
      ["no $metadata", undefined],
    ])(
      "keeps the message unchanged for an AWS SDK error with %s",
      async (_label, metadata) => {
        const client = new FakeMicrovmsClient();
        // The AWS SDK always sets $metadata. A custom client may not.
        const notFound = metadata
          ? new ResourceNotFoundException({
              message: "MicroVM not found",
              $metadata: metadata,
            })
          : Object.assign(new Error("MicroVM not found"), {
              name: "ResourceNotFoundException",
            });
        answerNotFound(client, operation, notFound);

        const error = await ensureRunning(options(client)).catch((e) => e);
        expect(error).toBeInstanceOf(MicrovmStateError);
        expect(error.message).toBe(removedMessage);
        expect(error.cause).toBe(notFound);
      },
    );
  });

  it("rethrows any other ResumeMicrovm error", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = [state("SUSPENDED")];
    const denied = Object.assign(new Error("denied"), {
      name: "AccessDeniedException",
    });
    client.resumeResponses = [throwing(denied)];

    await expect(ensureRunning(options(client))).rejects.toBe(denied);
  });

  it.each<"GetMicrovm" | "ResumeMicrovm">(["GetMicrovm", "ResumeMicrovm"])(
    "rethrows any other %s error as the same object, with the request ID in its message",
    async (operation) => {
      const client = new FakeMicrovmsClient();
      const denied = new AccessDeniedException({
        message: "denied",
        $metadata: { httpStatusCode: 403, requestId: "req-123" },
      });
      if (operation === "GetMicrovm") {
        client.getResponses = [throwing(denied)];
      } else {
        client.getResponses = [state("SUSPENDED")];
        client.resumeResponses = [throwing(denied)];
      }

      await expect(ensureRunning(options(client))).rejects.toBe(denied);
      expect(denied).toBeInstanceOf(AccessDeniedException);
      expect(denied.name).toBe("AccessDeniedException");
      expect(denied.message).toBe(`denied. ${operation} request ID: req-123.`);
    },
  );

  it.each<[string, Record<string, unknown>, string]>([
    [
      "with the request ID of the GetMicrovm answer",
      { $metadata: { httpStatusCode: 200, requestId: "req-123" } },
      "MicroVM mvm-1 is TERMINATED: MaximumDuration. GetMicrovm request ID: req-123.",
    ],
    [
      "without a request ID when the answer has none",
      { $metadata: { httpStatusCode: 200 } },
      "MicroVM mvm-1 is TERMINATED: MaximumDuration.",
    ],
  ])("reports a terminated MicroVM %s", async (_label, metadata, message) => {
    const client = new FakeMicrovmsClient();
    client.getResponses = [
      async () => ({
        state: "TERMINATED",
        stateReason: "MaximumDuration",
        ...metadata,
      }),
    ];

    const error = await ensureRunning(options(client)).catch((e) => e);
    expect(error).toBeInstanceOf(MicrovmStateError);
    expect(error.state).toBe("TERMINATED");
    expect(error.message).toBe(message);
  });

  it("gives up after maxWaitMs", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = Array.from({ length: 5 }, () => state("SUSPENDING"));
    const opts = { ...options(client), maxWaitMs: 300 };

    await expect(ensureRunning(opts)).rejects.toBeInstanceOf(
      MicrovmEndpointUnavailableError,
    );
    expect(client.events).toEqual(["get:SUSPENDING", "get:SUSPENDING"]);
  });

  it.each<[string, () => number | undefined]>([
    ["returns undefined", () => undefined],
    ["returns NaN", () => NaN],
    ["returns Infinity", () => Infinity],
  ])(
    "waits up to maxWaitMs when the remaining time %s",
    async (_label, remainingTimeMs) => {
      const client = new FakeMicrovmsClient();
      client.getResponses = [
        state("SUSPENDING"),
        state("SUSPENDING"),
        state("RUNNING"),
      ];

      await expect(
        ensureRunning({ ...options(client), remainingTimeMs }),
      ).resolves.toBe("mvm-1.example");
      expect(client.events).toEqual([
        "get:SUSPENDING",
        "get:SUSPENDING",
        "get:RUNNING",
      ]);
    },
  );

  it("gives up before the invocation times out", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = Array.from({ length: 5 }, () => state("SUSPENDING"));
    const opts = {
      ...options(client),
      // 10.5 seconds left keeps 500 ms after the 10-second reserve. A call
      // needs at least 1 second before the reserve. So no GetMicrovm starts.
      remainingTimeMs: () => 10_500,
    };

    await expect(ensureRunning(opts)).rejects.toBeInstanceOf(
      MicrovmEndpointUnavailableError,
    );
    expect(client.events).toEqual([]);
  });
});
