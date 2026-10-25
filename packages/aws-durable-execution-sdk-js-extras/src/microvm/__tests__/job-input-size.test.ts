import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { MAX_JOB_INPUT_BYTES, microvm, microvmSession } from "..";
import { baseConfig, FakeEndpoint, FakeMicrovmsClient } from "./fakes";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/** The largest job body that the worker accepts. */
const MAX_JOB_BODY_BYTES = 6 * 1024 * 1024;

const tooLarge = (name: string, bytes: number): string =>
  `MicroVM "${name}": the job input is ${bytes} bytes as JSON. The limit is ${MAX_JOB_INPUT_BYTES} bytes, because the worker accepts a job body of at most 6 MiB. Pass larger data by reference, for example as an S3 key.`;

// Each case is a padding character and its UTF-8 size. The input is a string
// of that character. Its JSON form adds 2 bytes for the quotes. So the
// largest input that fits has floor((limit - 2) / size) characters. "é" is 1
// UTF-16 code unit and 2 bytes. "😀" is 2 code units and 4 bytes. So a count
// of code units would accept the rejected inputs below.
const cases = [
  ["x", 1],
  ["é", 2],
  ["😀", 4],
] as const;

const boundary = (char: string, size: number) => {
  const count = Math.floor((MAX_JOB_INPUT_BYTES - 2) / size);
  return {
    fits: char.repeat(count),
    over: char.repeat(count + 1),
    overBytes: (count + 1) * size + 2,
  };
};

describe("microvm job input size", () => {
  it("is 6 MiB minus 8 KiB", () => {
    expect(MAX_JOB_INPUT_BYTES).toBe(6_283_264);
  });

  it.each(cases)(
    "accepts the largest input of %s that fits, and the body stays within 6 MiB",
    async (char, size) => {
      const input = boundary(char, size).fits;
      const client = new FakeMicrovmsClient();
      const endpoint = new FakeEndpoint();
      const runner = new LocalDurableTestRunner({
        handlerFunction: withDurableExecution(
          async (_event: unknown, context: DurableContext) =>
            microvm(context, "build", input, {
              ...baseConfig(client),
              heartbeatTimeout: { hours: 1 },
              fetch: endpoint.fetch,
            }),
        ),
      });

      const executionPromise = runner.run({ payload: {} });
      const callback = runner.getOperation("build.callback");
      await callback.waitForData(WaitingOperationStatus.STARTED);
      await runner
        .getOperation("build.request")
        .waitForData(WaitingOperationStatus.COMPLETED);
      await callback.sendCallbackSuccess(JSON.stringify("done"));
      const execution = await executionPromise;

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(endpoint.requests).toHaveLength(1);
      const body = endpoint.requests[0].body;
      expect(body.input).toBe(input);
      expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(
        MAX_JOB_BODY_BYTES,
      );
    },
  );

  it.each(cases)(
    "rejects an input of %s one character over the limit, before any durable operation",
    async (char, size) => {
      const { over, overBytes } = boundary(char, size);
      const client = new FakeMicrovmsClient();
      const endpoint = new FakeEndpoint();
      const runner = new LocalDurableTestRunner({
        handlerFunction: withDurableExecution(
          async (_event: unknown, context: DurableContext) =>
            microvm(context, "build", over, {
              ...baseConfig(client),
              fetch: endpoint.fetch,
            }),
        ),
      });

      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("FAILED");
      expect(execution.getError()?.errorType).toBe("RangeError");
      expect(execution.getError()?.errorMessage).toBe(
        tooLarge("build", overBytes),
      );
      expect(execution.getOperations()).toHaveLength(0);
      expect(client.runInputs).toHaveLength(0);
      expect(endpoint.requests).toHaveLength(0);
    },
  );

  it("rejects an input that JSON.stringify cannot encode, before any durable operation", async () => {
    let encodeError: unknown;
    try {
      JSON.stringify({ count: 1n });
    } catch (error) {
      encodeError = error;
    }
    const client = new FakeMicrovmsClient();
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) =>
          // The handler returns the error's fields, so the test can read
          // the cause.
          microvm(context, "build", { count: 1n }, baseConfig(client)).then(
            () => "no error",
            (reason: unknown) => {
              const error = reason as Error;
              return {
                name: error.name,
                message: error.message,
                causeName: (error.cause as Error).name,
                causeMessage: (error.cause as Error).message,
              };
            },
          ),
      ),
    });

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({
      name: "TypeError",
      message: `MicroVM "build": the job input must be JSON-serializable: ${(encodeError as Error).message}`,
      causeName: "TypeError",
      causeMessage: (encodeError as Error).message,
    });
    expect(execution.getOperations()).toHaveLength(0);
    expect(client.runInputs).toHaveLength(0);
  });

  it("accepts an undefined input, and sends a body without an input field", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) =>
          // `request.path` selects HTTP delivery. So the job goes in a body
          // that the test can read.
          microvm(context, "build", undefined, {
            ...baseConfig(client),
            heartbeatTimeout: { hours: 1 },
            request: { path: "/job" },
            fetch: endpoint.fetch,
          }),
      ),
    });

    const executionPromise = runner.run({ payload: {} });
    const callback = runner.getOperation("build.callback");
    await callback.waitForData(WaitingOperationStatus.STARTED);
    await runner
      .getOperation("build.request")
      .waitForData(WaitingOperationStatus.COMPLETED);
    await callback.sendCallbackSuccess(JSON.stringify("done"));
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(endpoint.requests).toHaveLength(1);
    expect("input" in endpoint.requests[0].body).toBe(false);
  });

  // JSON.stringify passes a toJSON method the key of the value. The key of a
  // root value is "". Every job body holds the input under the key "input".
  // So these inputs encode differently at the root and in the body.
  it("measures a key-sensitive toJSON under the key the body uses, and rejects it before any durable operation", async () => {
    const input = {
      toJSON(key: string) {
        return key === "input" ? "x".repeat(MAX_JOB_INPUT_BYTES + 1) : "";
      },
    };
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) =>
          microvm(context, "build", input, {
            ...baseConfig(client),
            fetch: endpoint.fetch,
          }),
      ),
    });

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()?.errorType).toBe("RangeError");
    // The value is MAX_JOB_INPUT_BYTES + 1 characters, plus 2 quotes.
    expect(execution.getError()?.errorMessage).toBe(
      tooLarge("build", MAX_JOB_INPUT_BYTES + 3),
    );
    expect(execution.getOperations()).toHaveLength(0);
    expect(client.runInputs).toHaveLength(0);
    expect(endpoint.requests).toHaveLength(0);
  });

  it("accepts a key-sensitive toJSON that is short under the key the body uses, and delivers that form", async () => {
    const input = {
      toJSON(key: string) {
        return key === "input" ? "short" : "x".repeat(MAX_JOB_INPUT_BYTES + 1);
      },
    };
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) =>
          // `request.path` selects HTTP delivery. So the job goes in a body
          // that the test can read.
          microvm(context, "build", input, {
            ...baseConfig(client),
            heartbeatTimeout: { hours: 1 },
            request: { path: "/job" },
            fetch: endpoint.fetch,
          }),
      ),
    });

    const executionPromise = runner.run({ payload: {} });
    const callback = runner.getOperation("build.callback");
    await callback.waitForData(WaitingOperationStatus.STARTED);
    await runner
      .getOperation("build.request")
      .waitForData(WaitingOperationStatus.COMPLETED);
    await callback.sendCallbackSuccess(JSON.stringify("done"));
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.runInputs).toHaveLength(1);
    expect(endpoint.requests).toHaveLength(1);
    expect(endpoint.requests[0].body.input).toBe("short");
  });
});

describe("vm.invoke job input size", () => {
  const runSession = (
    client: FakeMicrovmsClient,
    endpoint: FakeEndpoint,
    input: string,
  ) =>
    new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) =>
          microvmSession(
            context,
            "pipeline",
            {
              ...baseConfig(client),
              timeout: { hours: 1 },
              fetch: endpoint.fetch,
            },
            // The handler returns the error, so the test can read it.
            async (vm, ctx) =>
              vm
                .invoke<string>(ctx, "build", input, {
                  timeout: { minutes: 10 },
                })
                .catch(
                  (error: unknown) =>
                    `${(error as Error).name}: ${(error as Error).message}`,
                ),
          ),
      ),
    });

  it.each(cases)(
    "accepts the largest input of %s that fits",
    async (char, size) => {
      const input = boundary(char, size).fits;
      const client = new FakeMicrovmsClient();
      const endpoint = new FakeEndpoint();
      const runner = runSession(client, endpoint, input);

      const executionPromise = runner.run({ payload: {} });
      const callback = runner.getOperation("build.callback");
      await callback.waitForData(WaitingOperationStatus.STARTED);
      await runner
        .getOperation("build.request")
        .waitForData(WaitingOperationStatus.COMPLETED);
      await callback.sendCallbackSuccess(JSON.stringify("done"));
      const execution = await executionPromise;

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toBe("done");
      expect(endpoint.requests).toHaveLength(1);
      expect(endpoint.requests[0].body.input).toBe(input);
    },
  );

  it.each(cases)(
    "rejects an input of %s one character over the limit, before the job's durable operations",
    async (char, size) => {
      const { over, overBytes } = boundary(char, size);
      const client = new FakeMicrovmsClient();
      const endpoint = new FakeEndpoint();
      const runner = runSession(client, endpoint, over);

      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toBe(
        `RangeError: ${tooLarge("build", overBytes)}`,
      );
      // The session launched its MicroVM. The job created no operation and
      // sent no request.
      const names = execution
        .getOperations()
        .map((operation) => operation.getName());
      expect(names).not.toContain("build");
      expect(names).not.toContain("build.callback");
      expect(names).not.toContain("build.request");
      expect(client.runInputs).toHaveLength(1);
      expect(endpoint.requests).toHaveLength(0);
    },
  );
});
