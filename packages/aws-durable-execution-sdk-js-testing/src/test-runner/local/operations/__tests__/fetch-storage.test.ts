import { FetchStorage, TestFetchRequest } from "../fetch-storage";

describe("FetchStorage", () => {
  const request: TestFetchRequest = {
    url: "https://example.com/thing",
    method: "GET",
    headers: {},
    body: undefined,
    timeoutSeconds: undefined,
  };

  it("refuses to guess when no transport is registered", async () => {
    // Mirrors FunctionStorage: the runner will not reach outside the test on its own, and
    // says how to make it possible.
    const storage = new FetchStorage();

    await expect(storage.runFetch(request)).rejects.toThrow(
      /No fetch transport registered/,
    );
    await expect(storage.runFetch(request)).rejects.toThrow(
      /registerFetchTransport/,
    );
  });

  it("names the url that could not be issued", async () => {
    const storage = new FetchStorage();

    await expect(storage.runFetch(request)).rejects.toThrow(
      "https://example.com/thing",
    );
  });

  it("records a response as a completed exchange", async () => {
    const storage = new FetchStorage();
    storage.registerTransport(async () => ({
      status: 200,
      headers: { etag: "abc" },
      body: "hello",
    }));

    await expect(storage.runFetch(request)).resolves.toEqual({
      completed: true,
      details: {
        StatusCode: 200,
        Headers: { etag: "abc" },
        Result: "hello",
      },
    });
  });

  it.each([404, 500, 503])(
    "records a %i response as a completed exchange",
    async (status) => {
      const storage = new FetchStorage();
      storage.registerTransport(async () => ({ status, body: "nope" }));

      const outcome = await storage.runFetch(request);

      expect(outcome.completed).toBe(true);
      expect(outcome.details.StatusCode).toBe(status);
      expect(outcome.details.Error).toBeUndefined();
    },
  );

  it("lowercases response header names so lookups do not depend on casing", async () => {
    const storage = new FetchStorage();
    storage.registerTransport(async () => ({
      status: 200,
      headers: { "Content-Type": "application/json", ETag: "xyz" },
    }));

    const { details } = await storage.runFetch(request);

    expect(details.Headers).toEqual({
      "content-type": "application/json",
      etag: "xyz",
    });
  });

  it("treats a thrown transport as a request that never completed", async () => {
    const storage = new FetchStorage();
    storage.registerTransport(() =>
      Promise.reject(new Error("socket hang up")),
    );

    const outcome = await storage.runFetch(request);

    expect(outcome.completed).toBe(false);
    expect(outcome.details.StatusCode).toBeUndefined();
    expect(outcome.details.Error).toEqual({
      ErrorMessage: "socket hang up",
      ErrorType: "FetchError",
      StackTrace: expect.any(Array),
    });
  });

  it("records a non-Error rejection without losing the reason", async () => {
    const storage = new FetchStorage();
    storage.registerTransport(() => Promise.reject("refused"));

    const { details } = await storage.runFetch(request);

    expect(details.Error).toEqual({
      ErrorMessage: "refused",
      ErrorType: "FetchError",
    });
  });

  it("passes the request through to the transport unchanged", async () => {
    const storage = new FetchStorage();
    const seen: TestFetchRequest[] = [];
    storage.registerTransport(async (received) => {
      seen.push(received);
      return { status: 200 };
    });

    const post: TestFetchRequest = {
      url: "https://example.com/charges",
      method: "POST",
      headers: { authorization: "Bearer t" },
      body: '{"amount":100}',
      timeoutSeconds: 30,
    };
    await storage.runFetch(post);

    expect(seen).toEqual([post]);
  });

  it("uses the most recently registered transport", async () => {
    const storage = new FetchStorage();
    storage.registerTransport(async () => ({ status: 500 }));
    storage.registerTransport(async () => ({ status: 200 }));

    const { details } = await storage.runFetch(request);

    expect(details.StatusCode).toBe(200);
  });
});
