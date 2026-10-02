import { MicrovmEndpointUnavailableError } from "..";
import { ensureRunning, MicrovmStateError } from "../lifecycle";
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
    expect(error.message).toContain("session timeout plus 5 minutes");
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
