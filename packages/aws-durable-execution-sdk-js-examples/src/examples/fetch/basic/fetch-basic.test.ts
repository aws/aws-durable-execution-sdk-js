import {
  LocalDurableTestRunner,
  OperationStatus,
  TestFetchRequest,
  TestFetchResponse,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./fetch-basic";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/**
 * Fetch operations are satisfied by a transport the test registers, so nothing here touches
 * the network. Returning a response models an endpoint answering; throwing models a request
 * that never completed.
 */
describe("fetch basic", () => {
  const event = { productId: "p-1", quantity: 2 };

  /**
   * Routes by URL so one transport can serve both fetches in the workflow, and records what
   * was asked for.
   */
  const routingTransport = (
    routes: Record<string, TestFetchResponse>,
    seen: TestFetchRequest[] = [],
  ) => ({
    seen,
    transport: async (request: TestFetchRequest) => {
      seen.push(request);
      const match = Object.entries(routes).find(([prefix]) =>
        request.url.startsWith(prefix),
      );
      if (!match) {
        throw new Error(`unexpected url ${request.url}`);
      }
      return match[1];
    },
  });

  it("reserves stock when the product is available", async () => {
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const { transport, seen } = routingTransport({
      "https://inventory.example.com/products/": {
        status: 200,
        body: JSON.stringify({ inStock: 5 }),
      },
      "https://inventory.example.com/reservations": {
        status: 201,
        body: JSON.stringify({ id: "r-99" }),
      },
    });
    runner.registerFetchTransport(transport);

    const execution = await runner.run({ payload: event });

    expect(execution.getResult()).toEqual({
      reserved: true,
      reservationId: "r-99",
    });

    // Two fetches, and the POST carried the body the workflow built.
    expect(seen).toHaveLength(2);
    expect(seen[1]?.method).toBe("POST");
    expect(JSON.parse(seen[1]?.body ?? "{}")).toEqual({
      productId: "p-1",
      quantity: 2,
    });
    expect(seen[1]?.timeoutSeconds).toBe(30);

    // Each fetch is its own suspension: one invocation to start, one per resumption.
    expect(execution.getInvocations().length).toBe(3);
  });

  it("treats a 404 as a business outcome rather than a failure", async () => {
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const lookup = runner.getOperation("check-availability");
    const { transport, seen } = routingTransport({
      "https://inventory.example.com/products/": {
        status: 404,
        body: "no such product",
      },
    });
    runner.registerFetchTransport(transport);

    const execution = await runner.run({ payload: event });

    // The execution succeeded, and so did the fetch. Only the endpoint said no.
    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({
      reserved: false,
      reason: "availability lookup returned 404",
    });
    expect(lookup.getStatus()).toBe(OperationStatus.SUCCEEDED);
    expect(lookup.getFetchDetails()?.status).toBe(404);

    // The workflow returned before reserving, so the second endpoint was never called.
    expect(seen).toHaveLength(1);
  });

  it("maps a 409 on the reservation to an already-reserved outcome", async () => {
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const { transport } = routingTransport({
      "https://inventory.example.com/products/": {
        status: 200,
        body: JSON.stringify({ inStock: 5 }),
      },
      "https://inventory.example.com/reservations": { status: 409 },
    });
    runner.registerFetchTransport(transport);

    const execution = await runner.run({ payload: event });

    expect(execution.getResult()).toEqual({
      reserved: false,
      reason: "already reserved",
    });
  });

  it("fails the execution when the endpoint returns an unhandled status", async () => {
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const { transport } = routingTransport({
      "https://inventory.example.com/products/": {
        status: 200,
        body: JSON.stringify({ inStock: 5 }),
      },
      "https://inventory.example.com/reservations": {
        status: 500,
        body: "upstream exploded",
      },
    });
    runner.registerFetchTransport(transport);

    const execution = await runner.run({ payload: event });

    // The workflow chose to throw on a 500. The fetch itself still succeeded -- it is the
    // handler's `throw` that failed the execution.
    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()?.errorMessage).toContain(
      "Reservation failed with 500",
    );
  });

  it("fails the execution when a request never completed", async () => {
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    // A transport that throws models a transport-level failure, which is the one case
    // context.fetch rejects on.
    runner.registerFetchTransport(() =>
      Promise.reject(new Error("getaddrinfo ENOTFOUND inventory.example.com")),
    );

    const execution = await runner.run({ payload: event });

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()?.errorType).toBe("FetchError");
    expect(execution.getError()?.errorMessage).toContain("ENOTFOUND");
  });

  it("replays a recorded response instead of calling the endpoint again", async () => {
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const { transport, seen } = routingTransport({
      "https://inventory.example.com/products/": {
        status: 200,
        body: JSON.stringify({ inStock: 5 }),
      },
      "https://inventory.example.com/reservations": {
        status: 201,
        body: JSON.stringify({ id: "r-99" }),
      },
    });
    runner.registerFetchTransport(transport);

    await runner.run({ payload: event });

    // The workflow body ran three times across the three invocations, but each endpoint was
    // called once, because the second run reads the checkpointed response.
    const lookups = seen.filter((r) =>
      r.url.startsWith("https://inventory.example.com/products/"),
    );
    expect(lookups).toHaveLength(1);
  });
});
