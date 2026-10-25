import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { MAX_JOB_INPUT_BYTES, microvm, microvmSession } from "..";
import { validateJobInput, withJsonMember } from "../shared";
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

  it.each([
    ["null", null, "null"],
    ["undefined", undefined, "undefined"],
    ["a string", "no encoding here", "no encoding here"],
  ])(
    "names the operation when toJSON throws %s, and keeps the thrown value as the cause",
    async (_label, thrown, detail) => {
      const client = new FakeMicrovmsClient();
      const input = {
        toJSON() {
          throw thrown;
        },
      };
      const runner = new LocalDurableTestRunner({
        handlerFunction: withDurableExecution(
          async (_event: unknown, context: DurableContext) =>
            microvm(context, "build", input, baseConfig(client)).then(
              () => "no error",
              (reason: unknown) => {
                const error = reason as Error;
                return {
                  name: error.name,
                  message: error.message,
                  causeIsThrown: error.cause === thrown,
                  hasCause: "cause" in error,
                };
              },
            ),
        ),
      });

      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toEqual({
        name: "TypeError",
        message: `MicroVM "build": the job input must be JSON-serializable: ${detail}`,
        causeIsThrown: true,
        hasCause: true,
      });
      expect(execution.getOperations()).toHaveLength(0);
      expect(client.runInputs).toHaveLength(0);
    },
  );

  it("names the operation for an invoke whose input's toJSON throws null", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const input = {
      toJSON() {
        throw null;
      },
    };
    const runner = new LocalDurableTestRunner({
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

    const execution = await runner.run({ payload: {} });

    expect(execution.getResult()).toBe(
      'TypeError: MicroVM "build": the job input must be JSON-serializable: null',
    );
    expect(endpoint.requests).toHaveLength(0);
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

/**
 * Returns an input whose `toJSON` returns "small" on its first call and a
 * 7 MiB string on every later call. It records the number of calls.
 *
 * A check that encodes the input once and a body that encodes it again
 * would see different values. The check would accept "small", and the body
 * would carry 7 MiB. The worker refuses a body over 6 MiB.
 */
const statefulInput = () => {
  const state = { calls: 0 };
  const input = {
    toJSON() {
      state.calls += 1;
      return state.calls === 1 ? "small" : "x".repeat(7 * 1024 * 1024);
    },
  };
  return { input, state };
};

describe("job input encoded once", () => {
  // Each invocation calls the handler again, and the handler creates a new
  // input. So each state counts the `toJSON` calls of one call to the
  // operation. The set of counts is {1} when every call encoded its input
  // once, and empty when no call ran.
  const callsPerCall = (states: { calls: number }[]): Set<number> =>
    new Set(states.map((state) => state.calls));

  it("microvm sends the measured form over HTTP, and calls toJSON once per call", async () => {
    const states: { calls: number }[] = [];
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) => {
          const { input, state } = statefulInput();
          states.push(state);
          // `request.path` selects HTTP delivery. So the job goes in a body
          // that the test can read.
          return microvm(context, "build", input, {
            ...baseConfig(client),
            heartbeatTimeout: { hours: 1 },
            request: { path: "/job" },
            fetch: endpoint.fetch,
          });
        },
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
    expect(body.input).toBe("small");
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(4096);
    expect(callsPerCall(states)).toEqual(new Set([1]));
  });

  it("microvm sends the measured form in the run hook, and calls toJSON once per call", async () => {
    const states: { calls: number }[] = [];
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) => {
          const { input, state } = statefulInput();
          states.push(state);
          return microvm(context, "build", input, {
            ...baseConfig(client),
            fetch: endpoint.fetch,
          });
        },
      ),
    });

    const executionPromise = runner.run({ payload: {} });
    const callback = runner.getOperation("build.callback");
    await callback.waitForData(WaitingOperationStatus.STARTED);
    await runner
      .getOperation("build.launch")
      .waitForData(WaitingOperationStatus.COMPLETED);
    await callback.sendCallbackSuccess(JSON.stringify("done"));
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    // "small" fits in the run hook. So the launch carries the job, and the
    // operation sends no HTTP request.
    expect(client.runInputs).toHaveLength(1);
    const payload = JSON.parse(client.runInputs[0].runHookPayload as string);
    expect(payload.job.input).toBe("small");
    expect(endpoint.requests).toHaveLength(0);
    expect(callsPerCall(states)).toEqual(new Set([1]));
  });

  it("vm.invoke sends the measured form, and calls toJSON once per call", async () => {
    const states: { calls: number }[] = [];
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = new LocalDurableTestRunner({
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
            async (vm, ctx) => {
              const { input, state } = statefulInput();
              states.push(state);
              return vm.invoke<string>(ctx, "build", input, {
                timeout: { minutes: 10 },
              });
            },
          ),
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
    expect(execution.getResult()).toBe("done");
    expect(endpoint.requests).toHaveLength(1);
    const body = endpoint.requests[0].body;
    expect(body.input).toBe("small");
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(4096);
    expect(callsPerCall(states)).toEqual(new Set([1]));
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

describe("measured input text", () => {
  // A Proxy can list an object's keys in any order. JSON.parse creates
  // integer keys first. So a parse and a second encode would reorder these
  // members. The body must hold the measured text as it is.
  it("goes into the body unchanged, with the member order of the encode", () => {
    const input = new Proxy({ b: 1, 1: 2 } as Record<string, number>, {
      ownKeys: () => ["b", "1"],
    });

    const inputJson = validateJobInput("build", input);

    expect(inputJson).toBe('{"b":1,"1":2}');
    expect(withJsonMember({ callbackId: "id" }, "input", inputJson)).toBe(
      '{"callbackId":"id","input":{"b":1,"1":2}}',
    );
  });

  it("is undefined for an input that encodes to no value, and the body has no input member", () => {
    const inputJson = validateJobInput("build", undefined);

    expect(inputJson).toBeUndefined();
    expect(withJsonMember({ callbackId: "id" }, "input", inputJson)).toBe(
      '{"callbackId":"id"}',
    );
  });

  it("follows an empty object without a comma", () => {
    expect(withJsonMember({}, "input", '"x"')).toBe('{"input":"x"}');
  });
});
