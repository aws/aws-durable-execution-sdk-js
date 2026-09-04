import {
  FetchBodyEncoding,
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
          Timeout: undefined,
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

  it("keeps request headers and body out of the execution history", async () => {
    // `GetDurableExecutionHistory` needs only an execution ARN -- no checkpoint token -- and
    // includes execution data by default, so anything recorded here is readable by every
    // principal with Lambda read access to the function. Request headers are where
    // credentials live: a SigV4 signer puts an STS session token in `x-amz-security-token`,
    // so recording them would turn read-only Lambda access into a credential.
    const handler = withDurableExecution(async (_, ctx) => {
      await ctx.fetch("signed", "https://api.example.com/signed", {
        method: "POST",
        headers: {
          authorization: "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/...",
          "x-amz-security-token": "SESSION-TOKEN-SHOULD-NOT-BE-RECORDED",
        },
        body: "SECRET-BODY-SHOULD-NOT-BE-RECORDED",
      });
      return null;
    });

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const seen: TestFetchRequest[] = [];
    runner.registerFetchTransport(async (request) => {
      seen.push(request);
      return { status: 200 };
    });

    const execution = await runner.run();

    // The backend still receives them -- the request could not be issued otherwise.
    expect(seen[0]?.headers["x-amz-security-token"]).toBe(
      "SESSION-TOKEN-SHOULD-NOT-BE-RECORDED",
    );
    expect(seen[0]?.body).toBe("SECRET-BODY-SHOULD-NOT-BE-RECORDED");

    // Nothing sensitive reaches the history, whichever event or field it might hide in.
    const serializedHistory = JSON.stringify(execution.getHistoryEvents());
    expect(serializedHistory).not.toContain(
      "SESSION-TOKEN-SHOULD-NOT-BE-RECORDED",
    );
    expect(serializedHistory).not.toContain(
      "SECRET-BODY-SHOULD-NOT-BE-RECORDED",
    );
    expect(serializedHistory).not.toContain("AWS4-HMAC-SHA256");
    // The url is recorded, so the operation is still identifiable.
    expect(serializedHistory).toContain("https://api.example.com/signed");
  });

  it("keeps request headers and body out of the readable operation state", async () => {
    // `Operation.FetchDetails` describes the response only; the request travels on the
    // `OperationUpdate`, which is a send-shape that no read API returns. Asserted so a later
    // change cannot quietly start echoing the request back through operation state.
    const handler = withDurableExecution(async (_, ctx) => {
      await ctx.fetch("signed", "https://api.example.com/signed", {
        headers: {
          "x-amz-security-token": "SESSION-TOKEN-SHOULD-NOT-BE-RECORDED",
        },
        body: "SECRET-BODY-SHOULD-NOT-BE-RECORDED",
      });
      return null;
    });

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const fetchOperation = runner.getOperation("signed");
    runner.registerFetchTransport(async () => ({ status: 200 }));

    await runner.run();

    const serializedOperation = JSON.stringify(
      fetchOperation.getOperationData(),
    );
    expect(serializedOperation).not.toContain(
      "SESSION-TOKEN-SHOULD-NOT-BE-RECORDED",
    );
    expect(serializedOperation).not.toContain(
      "SECRET-BODY-SHOULD-NOT-BE-RECORDED",
    );
  });

  it("omits BodyEncoding for a UTF-8 response, so absent means UTF8 end to end", async () => {
    // The whole compatibility argument rests on this: a plain text response records no
    // encoding at all, so a reader that predates the field is still correct.
    const handler = withDurableExecution(async (_, ctx) => {
      const response = await ctx.fetch("plain", "https://api.example.com/x");
      return response.body;
    });

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const fetchOperation = runner.getOperation("plain");
    runner.registerFetchTransport(async () => ({
      status: 200,
      body: "plain text",
    }));

    const execution = await runner.run();

    expect(execution.getResult()).toBe("plain text");
    expect(fetchOperation.getFetchDetails()?.bodyEncoding).toBeUndefined();
    expect(fetchOperation.getOperationData()?.FetchDetails).not.toHaveProperty(
      "BodyEncoding",
    );
  });

  it("carries a BASE64 encoding through the backend and refuses to read it", async () => {
    // Models a backend newer than the SDK. Proves the discriminator survives the round trip
    // -- checkpoint, operation state and history -- and that the SDK refuses rather than
    // handing the workflow a corrupted body.
    const handler = withDurableExecution(async (_, ctx) => {
      try {
        await ctx.fetch("binary", "https://api.example.com/image");
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
    const fetchOperation = runner.getOperation("binary");
    runner.registerFetchTransport(async () => ({
      status: 200,
      body: "AAECAw==",
      bodyEncoding: FetchBodyEncoding.BASE64,
    }));

    const execution = await runner.run();

    const result = execution.getResult() as {
      threw: boolean;
      isFetchError: boolean;
      message: string;
    };
    expect(result.threw).toBe(true);
    expect(result.isFetchError).toBe(true);
    expect(result.message).toContain("BASE64-encoded response body");

    // The operation itself succeeded -- the exchange completed. Only reading it failed.
    expect(fetchOperation.getStatus()).toBe("SUCCEEDED");
    expect(fetchOperation.getFetchDetails()?.bodyEncoding).toBe(
      FetchBodyEncoding.BASE64,
    );

    // And the encoding is in the history, so a recorded body is interpretable from the
    // record alone rather than from whichever SDK version produced it.
    const fetchSucceeded = execution
      .getHistoryEvents()
      ?.find((event) => event.EventType === "FetchSucceeded");
    expect(fetchSucceeded?.FetchSucceededDetails?.BodyEncoding).toBe(
      FetchBodyEncoding.BASE64,
    );
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
