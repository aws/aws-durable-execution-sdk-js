import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  TestFetchRequest,
} from "@aws/durable-execution-sdk-js-testing";
import { durableFetch } from "../durable-fetch";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/**
 * Exercises `durableFetch` the way a fetch-based client does: `new Request`-able inputs, a
 * JSON body, and an SSE response read as a stream. No real client is installed here, so the
 * call patterns those SDKs use are reproduced directly against the returned `fetch`.
 */
describe("durableFetch", () => {
  it("presents itself as fetch and returns a usable Response", async () => {
    const handler = withDurableExecution(
      async (_: unknown, context: DurableContext) => {
        const fetch = durableFetch(context, "chat");

        const response = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              authorization: "Bearer sk-test",
              "content-type": "application/json",
            },
            body: JSON.stringify({ model: "gpt-4o", messages: [] }),
          },
        );

        // The client-facing surface of a real Response.
        const payload = (await response.json()) as {
          choices: { message: { content: string } }[];
        };

        return {
          ok: response.ok,
          status: response.status,
          contentType: response.headers.get("content-type"),
          content: payload.choices[0]?.message.content,
        };
      },
    );

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const seen: TestFetchRequest[] = [];
    runner.registerFetchTransport(async (request) => {
      seen.push(request);
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          choices: [{ message: { content: "hello from the model" } }],
        }),
      };
    });

    const execution = await runner.run();

    expect(execution.getResult()).toEqual({
      ok: true,
      status: 200,
      contentType: "application/json",
      content: "hello from the model",
    });

    // The request reached the backend intact, headers and body included.
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(seen[0]?.headers.authorization).toBe("Bearer sk-test");
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({
      model: "gpt-4o",
      messages: [],
    });
  });

  it("accepts a Request object, as clients that build one do", async () => {
    const handler = withDurableExecution(
      async (_: unknown, context: DurableContext) => {
        const fetch = durableFetch(context, "messages");

        const response = await fetch(
          new Request("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": "sk-ant-test" },
            body: JSON.stringify({ model: "claude" }),
          }),
        );

        return response.status;
      },
    );

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const seen: TestFetchRequest[] = [];
    runner.registerFetchTransport(async (request) => {
      seen.push(request);
      return { status: 200, body: "{}" };
    });

    await runner.run();

    expect(seen[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0]?.headers["x-api-key"]).toBe("sk-ant-test");
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ model: "claude" });
  });

  it("lets an SSE parser read the whole stream, non-incrementally", async () => {
    // The streaming claim, verified: the body is a real ReadableStream, so a client's SSE
    // parser works and yields every event -- they simply all arrive at once.
    const handler = withDurableExecution(
      async (_: unknown, context: DurableContext) => {
        const fetch = durableFetch(context, "chat-stream");

        const response = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            body: JSON.stringify({ stream: true }),
          },
        );

        if (!response.body) {
          throw new Error("expected a streamed body");
        }

        // A minimal version of what the OpenAI and Anthropic SDKs do.
        const decoder = new TextDecoder();
        let buffered = "";
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          buffered += decoder.decode(chunk, { stream: true });
        }

        const deltas = buffered
          .split("\n\n")
          .filter((block) => block.startsWith("data: "))
          .map((block) => block.slice("data: ".length))
          .filter((data) => data !== "[DONE]")
          .map((data) => (JSON.parse(data) as { delta: string }).delta);

        return deltas.join("");
      },
    );

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerFetchTransport(async () => ({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: [
        'data: {"delta":"Hel"}',
        'data: {"delta":"lo "}',
        'data: {"delta":"world"}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
    }));

    const execution = await runner.run();

    expect(execution.getResult()).toBe("Hello world");
  });

  it("returns a bodyless Response for statuses that forbid one", async () => {
    const handler = withDurableExecution(
      async (_: unknown, context: DurableContext) => {
        const response = await durableFetch(context, "delete")(
          "https://api.example.com/thing",
          { method: "DELETE" },
        );
        return { status: response.status, hasBody: response.body !== null };
      },
    );

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerFetchTransport(async () => ({ status: 204 }));

    const execution = await runner.run();

    // Constructing a 204 with a body throws, so the adapter has to special-case it.
    expect(execution.getResult()).toEqual({ status: 204, hasBody: false });
  });

  it("hands a 4xx back as a response, leaving the client to interpret it", async () => {
    // Matters because these SDKs turn a 429 into a typed rate-limit error themselves, which
    // only works if the response reaches them rather than being raised as a fetch failure.
    const handler = withDurableExecution(
      async (_: unknown, context: DurableContext) => {
        const response = await durableFetch(context, "chat")(
          "https://api.openai.com/v1/chat/completions",
          { method: "POST", body: "{}" },
        );
        return {
          ok: response.ok,
          status: response.status,
          retryAfter: response.headers.get("retry-after"),
          body: await response.text(),
        };
      },
    );

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerFetchTransport(async () => ({
      status: 429,
      headers: { "retry-after": "30" },
      body: JSON.stringify({ error: { message: "slow down" } }),
    }));

    const execution = await runner.run();

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({
      ok: false,
      status: 429,
      retryAfter: "30",
      body: JSON.stringify({ error: { message: "slow down" } }),
    });
  });

  it("keeps the api key out of the execution history", async () => {
    const handler = withDurableExecution(
      async (_: unknown, context: DurableContext) => {
        await durableFetch(context, "chat")(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: { authorization: "Bearer sk-SECRET-KEY" },
            body: "{}",
          },
        );
        return null;
      },
    );

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerFetchTransport(async () => ({ status: 200, body: "{}" }));

    const execution = await runner.run();

    expect(JSON.stringify(execution.getHistoryEvents())).not.toContain(
      "sk-SECRET-KEY",
    );
  });
});
