// The extras package builds the documents that the worker package parses.
// The two packages declare the contract types separately, because one runs in
// the function and the other in the MicroVM. These tests fail when the two
// declarations or the two implementations drift apart.
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import {
  MICROVM_JOB_PATH,
  type MicrovmJobDocument as WorkerJobDocument,
  type MicrovmJobRequest as WorkerJobRequest,
  type MicrovmRunHookPayload as WorkerRunHookPayload,
  parseJobRequest,
  parseRunHookRequest,
  SUPPORTED_PAYLOAD_VERSION,
} from "@aws/durable-execution-sdk-js-microvm-worker";
import {
  DEFAULT_MICROVM_JOB_PATH,
  type MicrovmJobDocument,
  type MicrovmJobRequest,
  type MicrovmRunHookPayload,
  microvm,
  microvmSession,
} from "..";
import { baseConfig, FakeEndpoint, FakeMicrovmsClient } from "./fakes";

// Compile-time checks: each pair of declarations must be mutually
// assignable. `tsc --noEmit` in the test script fails when they differ.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Input = { repo: string; attempt: number };
const jobDocumentsMatch: Same<
  MicrovmJobDocument<Input>,
  WorkerJobDocument<Input>
> = true;
const jobRequestsMatch: Same<
  MicrovmJobRequest<Input>,
  WorkerJobRequest<Input>
> = true;
const runHookPayloadsMatch: Same<
  MicrovmRunHookPayload<Input>,
  WorkerRunHookPayload<Input>
> = true;

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

const input: Input = { repo: "org/app", attempt: 2 };

/** Runs one microvm call and returns the fake client and endpoint. */
async function runMicrovm(
  delivery: "run-hook" | "route" | "too-large",
): Promise<{ client: FakeMicrovmsClient; endpoint: FakeEndpoint }> {
  const client = new FakeMicrovmsClient();
  const endpoint = new FakeEndpoint();
  const jobInput =
    delivery === "too-large" ? { ...input, blob: "x".repeat(5_000) } : input;
  const runner = new LocalDurableTestRunner({
    handlerFunction: withDurableExecution(
      async (_event: unknown, context: DurableContext) =>
        microvm(context, "job", jobInput, {
          ...baseConfig(client),
          heartbeatTimeout: { seconds: 45 },
          fetch: endpoint.fetch,
          ...(delivery === "route" && { request: { path: "/job" } }),
        }),
    ),
  });
  const executionPromise = runner.run({ payload: {} });
  const callback = runner.getOperation("job.callback");
  await callback.waitForData(WaitingOperationStatus.STARTED);
  await runner
    .getOperation("job.launch")
    .waitForData(WaitingOperationStatus.COMPLETED);
  if (delivery !== "run-hook") {
    await runner
      .getOperation("job.request")
      .waitForData(WaitingOperationStatus.COMPLETED);
  }
  await callback.sendCallbackSuccess(JSON.stringify("done"));
  expect((await executionPromise).getStatus()).toBe("SUCCEEDED");
  return { client, endpoint };
}

describe("contract between extras and the worker", () => {
  it("declares the same types in both packages", () => {
    expect([jobDocumentsMatch, jobRequestsMatch, runHookPayloadsMatch]).toEqual(
      [true, true, true],
    );
  });

  it("builds a run hook payload with a job that the worker parses", async () => {
    const { client } = await runMicrovm("run-hook");
    const runHookPayload = client.runInputs[0].runHookPayload as string;

    const parsed = parseRunHookRequest<Input>({
      microvmId: "mvm-1",
      runHookPayload,
    });

    expect(parsed.payload?.version).toBe(SUPPORTED_PAYLOAD_VERSION);
    expect(parsed.payload?.job).toEqual({
      callbackId: expect.any(String),
      heartbeatTimeoutSeconds: 45,
      input,
    });
  });

  it("builds a run hook payload without a job and a job request that the worker parses", async () => {
    const { client, endpoint } = await runMicrovm("route");

    const parsedHook = parseRunHookRequest({
      microvmId: "mvm-1",
      runHookPayload: client.runInputs[0].runHookPayload as string,
    });
    const parsedJob = parseJobRequest<Input>(endpoint.requests[0].body);

    expect(parsedHook.payload?.job).toBeUndefined();
    expect(parsedJob).toEqual({
      version: SUPPORTED_PAYLOAD_VERSION,
      region: parsedHook.payload?.region,
      // The same MicroVM ID as the run hook, so a worker that gets the job
      // first knows it too.
      microvmId: parsedHook.microvmId,
      callbackId: expect.any(String),
      heartbeatTimeoutSeconds: 45,
      input,
    });
  });

  it("sends a job too large for the run hook to the path that the worker serves with handler", async () => {
    const { endpoint } = await runMicrovm("too-large");

    expect(DEFAULT_MICROVM_JOB_PATH).toBe(MICROVM_JOB_PATH);
    expect(new URL(endpoint.requests[0].url).pathname).toBe(MICROVM_JOB_PATH);
    expect(parseJobRequest<Input>(endpoint.requests[0].body).input).toEqual({
      ...input,
      blob: "x".repeat(5_000),
    });
  });

  it("builds a session run hook payload that the worker parses", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) =>
          microvmSession(
            context,
            "session",
            { ...baseConfig(client), fetch: endpoint.fetch },
            async () => "no jobs",
          ),
      ),
    });

    expect((await runner.run({ payload: {} })).getStatus()).toBe("SUCCEEDED");
    const parsed = parseRunHookRequest({
      microvmId: "mvm-1",
      runHookPayload: client.runInputs[0].runHookPayload as string,
    });

    expect(parsed.payload).toEqual({
      version: SUPPORTED_PAYLOAD_VERSION,
      region: expect.any(String),
      autoSuspendIdleSeconds: 60,
    });
  });
});
