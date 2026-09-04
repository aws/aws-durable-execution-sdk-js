import {
  FetchError,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";
import { TestFetchRequest } from "../../operations/fetch-storage";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("LocalDurableTestRunner Fetch operations integration", () => {
  it("resolves with the recorded response and passes the request through to the transport", async () => {
    const handler = withDurableExecution(async (_, ctx) => {
      const response = await ctx.fetch(
        "chargeCard",
        "https://api.example.com/charges",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amount: 100 }),
        },
      );

      return {
        status: response.status,
        ok: response.ok,
        charge: JSON.parse(response.body),
      };
    });

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const fetchOperation = runner.getOperation("chargeCard");

    const seen: TestFetchRequest[] = [];
    runner.registerFetchTransport(async (request) => {
      seen.push(request);
      return {
        status: 201,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "ch_1" }),
      };
    });

    const execution = await runner.run();

    expect(execution.getResult()).toEqual({
      status: 201,
      ok: true,
      charge: { id: "ch_1" },
    });

    // Everything the workflow asked for reaches the backend, and the body travels as the
    // operation payload rather than inside the options.
    expect(seen).toEqual([
      {
        url: "https://api.example.com/charges",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: 100 }),
        timeoutSeconds: undefined,
      },
    ]);

    expect(fetchOperation.getFetchDetails()).toEqual({
      status: 201,
      // Recorded lowercased, so a workflow can look a header up without guessing its case.
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "ch_1" }),
      error: undefined,
    });
  });

  it("suspends the execution while the request is in flight", async () => {
    const handler = withDurableExecution(async (_, ctx) => {
      const response = await ctx.fetch("ping", "https://api.example.com/ping");
      return response.body;
    });

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerFetchTransport(async () => ({ status: 200, body: "pong" }));

    const execution = await runner.run();

    expect(execution.getResult()).toBe("pong");
    // The whole point of the operation being backend-driven: the first invocation ends at
    // the fetch and a second one resumes with the response, rather than one invocation
    // blocking on the socket.
    expect(execution.getInvocations().length).toBe(2);
  });

  it("records a 4xx as a successful operation carrying the response", async () => {
    const handler = withDurableExecution(async (_, ctx) => {
      const response = await ctx.fetch("lookup", "https://api.example.com/x");
      return { status: response.status, ok: response.ok, body: response.body };
    });

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const fetchOperation = runner.getOperation("lookup");

    runner.registerFetchTransport(async () => ({
      status: 404,
      body: "not found",
    }));

    const execution = await runner.run();

    // A status the endpoint chose to send is a result, not a failure. The workflow decides.
    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({
      status: 404,
      ok: false,
      body: "not found",
    });
    expect(fetchOperation.getStatus()).toBe("SUCCEEDED");
    expect(fetchOperation.getFetchDetails()?.error).toBeUndefined();
  });

  it("records a 5xx as a successful operation carrying the response", async () => {
    const handler = withDurableExecution(async (_, ctx) => {
      const response = await ctx.fetch("lookup", "https://api.example.com/x");
      return { status: response.status, ok: response.ok };
    });

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    runner.registerFetchTransport(async () => ({ status: 503 }));

    const execution = await runner.run();

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({ status: 503, ok: false });
  });

  it("rejects with a FetchError when the request never completed", async () => {
    const handler = withDurableExecution(async (_, ctx) => {
      try {
        await ctx.fetch("unreachable", "https://api.example.com/x");
        return { threw: false };
      } catch (err) {
        return {
          threw: true,
          isFetchError: err instanceof FetchError,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    });

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const fetchOperation = runner.getOperation("unreachable");

    runner.registerFetchTransport(() =>
      Promise.reject(new Error("getaddrinfo ENOTFOUND api.example.com")),
    );

    const execution = await runner.run();

    expect(execution.getResult()).toEqual({
      threw: true,
      isFetchError: true,
      message: "getaddrinfo ENOTFOUND api.example.com",
    });
    expect(fetchOperation.getStatus()).toBe("FAILED");
    expect(fetchOperation.getFetchDetails()?.status).toBeUndefined();
    expect(fetchOperation.getFetchDetails()?.error?.errorMessage).toBe(
      "getaddrinfo ENOTFOUND api.example.com",
    );
  });

  it("defaults the method to GET and sends no body", async () => {
    const handler = withDurableExecution(async (_, ctx) => {
      await ctx.fetch("https://api.example.com/status");
      return null;
    });

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const seen: TestFetchRequest[] = [];
    runner.registerFetchTransport(async (request) => {
      seen.push(request);
      return { status: 200 };
    });

    await runner.run();

    expect(seen[0]).toEqual({
      url: "https://api.example.com/status",
      method: "GET",
      headers: {},
      body: undefined,
      timeoutSeconds: undefined,
    });
  });

  it("passes a configured timeout to the backend as seconds", async () => {
    const handler = withDurableExecution(async (_, ctx) => {
      await ctx.fetch("slow", "https://api.example.com/slow", {
        timeout: { minutes: 2, seconds: 30 },
      });
      return null;
    });

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const seen: TestFetchRequest[] = [];
    runner.registerFetchTransport(async (request) => {
      seen.push(request);
      return { status: 200 };
    });

    await runner.run();

    expect(seen[0]?.timeoutSeconds).toBe(150);
  });

  it("replays a completed fetch without reissuing the request", async () => {
    const handler = withDurableExecution(async (_, ctx) => {
      const response = await ctx.fetch("once", "https://api.example.com/once");
      // Forces a replay after the fetch has already been recorded.
      await ctx.wait({ seconds: 1 });
      return response.body;
    });

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    let calls = 0;
    runner.registerFetchTransport(async () => {
      calls += 1;
      return { status: 200, body: "recorded once" };
    });

    const execution = await runner.run();

    expect(execution.getResult()).toBe("recorded once");
    // The checkpointed response is what the replay sees, so the endpoint is hit once even
    // though the code around the fetch runs more than once.
    expect(calls).toBe(1);
  });

  it("records the history a fetch produces", async () => {
    const handler = withDurableExecution(async (_, ctx) => {
      const response = await ctx.fetch("call", "https://api.example.com/call", {
        method: "PUT",
        body: "hello",
      });
      return response.status;
    });

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerFetchTransport(async () => ({
      status: 200,
      headers: { etag: "abc" },
      body: "world",
    }));

    const execution = await runner.run();

    const fetchEvents = execution
      .getHistoryEvents()
      ?.filter((event) => event.EventType?.startsWith("Fetch"));

    expect(fetchEvents).toEqual([
      {
        EventType: "FetchStarted",
        SubType: "Fetch",
        EventId: expect.any(Number),
        Id: expect.any(String),
        Name: "call",
        EventTimestamp: expect.any(Date),
        FetchStartedDetails: {
          Url: "https://api.example.com/call",
          Method: "PUT",
          Headers: undefined,
          Timeout: undefined,
          Input: { Payload: "hello" },
        },
      },
      {
        EventType: "FetchSucceeded",
        SubType: "Fetch",
        EventId: expect.any(Number),
        Id: expect.any(String),
        Name: "call",
        EventTimestamp: expect.any(Date),
        FetchSucceededDetails: {
          StatusCode: 200,
          Headers: { etag: "abc" },
          Result: { Payload: "world" },
          Error: undefined,
        },
      },
    ]);
  });

  it("fails the fetch with a pointer to registerFetchTransport when none is registered", async () => {
    const handler = withDurableExecution(async (_, ctx) => {
      await ctx.fetch("https://api.example.com/x");
      return null;
    });

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    // No transport registered: reaching the network on its own would make this test depend
    // on an endpoint it does not control, so the runner refuses and says what to do.
    await expect(runner.run()).rejects.toThrow(/registerFetchTransport/);
  });
});
