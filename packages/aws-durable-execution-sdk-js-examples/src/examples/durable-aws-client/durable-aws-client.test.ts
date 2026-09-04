import {
  LocalDurableTestRunner,
  TestFetchRequest,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./durable-aws-client";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/**
 * Exercises the real AWS SDK middleware stack. Nothing here stubs the client -- the
 * DynamoDB client serializes, resolves the endpoint and signs as it always would, and the
 * assertions below are on what came out the bottom of that stack.
 */
describe("durable AWS client", () => {
  const region = "us-east-1";

  beforeEach(() => {
    // Signing needs credentials and a region. Fake but well-formed, so SigV4 produces a real
    // signature rather than failing to resolve.
    process.env.AWS_REGION = region;
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY =
      "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    process.env.AWS_SESSION_TOKEN = "TEST-SESSION-TOKEN";
  });

  it("routes a real signed AWS request through context.fetch", async () => {
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const seen: TestFetchRequest[] = [];
    runner.registerFetchTransport(async (request) => {
      seen.push(request);
      return {
        status: 200,
        headers: { "content-type": "application/x-amz-json-1.0" },
        body: JSON.stringify({ Item: { id: { S: "abc" } } }),
      };
    });

    const execution = await runner.run({
      payload: { tableName: "my-table", id: "abc" },
    });

    // The AWS SDK deserialized our synthesized response, so the workflow saw a real GetItem
    // result rather than a raw body.
    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({ found: true });

    const request = seen[0];
    expect(request).toBeDefined();
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(`https://dynamodb.${region}.amazonaws.com/`);

    // Produced by the SDK's own serializer, untouched by the handler.
    expect(request?.headers["x-amz-target"]).toBe("DynamoDB_20120810.GetItem");
    expect(JSON.parse(request?.body ?? "{}")).toEqual({
      TableName: "my-table",
      Key: { id: { S: "abc" } },
    });

    // The request really was signed on the way through.
    expect(request?.headers.authorization).toContain("AWS4-HMAC-SHA256");
    expect(request?.headers.authorization).toContain("dynamodb");
    expect(request?.headers["x-amz-security-token"]).toBe("TEST-SESSION-TOKEN");
  });

  it("suspends the execution while the AWS call is in flight", async () => {
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerFetchTransport(async () => ({
      status: 200,
      body: JSON.stringify({}),
    }));

    const execution = await runner.run({
      payload: { tableName: "my-table", id: "abc" },
    });

    expect(execution.getResult()).toEqual({ found: false });
    // The point of the exercise: the AWS call costs an invocation boundary, not a blocked
    // socket inside one invocation.
    expect(execution.getInvocations().length).toBe(2);
  });

  it("keeps the signed credentials out of the execution history", async () => {
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerFetchTransport(async () => ({
      status: 200,
      body: JSON.stringify({}),
    }));

    const execution = await runner.run({
      payload: { tableName: "my-table", id: "abc" },
    });

    // Execution history is readable by anyone with Lambda read access to the function, so a
    // signed request passing through here must not leave the session token behind.
    const history = JSON.stringify(execution.getHistoryEvents());
    expect(history).not.toContain("TEST-SESSION-TOKEN");
    expect(history).not.toContain("AWS4-HMAC-SHA256");
    // The url is still recorded, so the call remains auditable.
    expect(history).toContain(`https://dynamodb.${region}.amazonaws.com/`);
  });

  it("surfaces a service error as the AWS SDK's own typed exception", async () => {
    // This is why no bespoke error classification lives in the handler: because the response
    // is handed back faithfully -- status, headers and a readable body -- the SDK's error
    // deserializer names the failure itself. A stale SigV4 signature arrives as
    // `InvalidSignatureException` through exactly this path, so a workflow can match on it
    // and retry, which re-signs on the next invocation.
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerFetchTransport(async () => ({
      status: 403,
      headers: { "content-type": "application/x-amz-json-1.0" },
      body: JSON.stringify({
        __type: "com.amazon.coral.service#InvalidSignatureException",
        message: "Signature expired",
      }),
    }));

    const execution = await runner.run({
      payload: { tableName: "my-table", id: "abc" },
    });

    expect(execution.getStatus()).toBe("FAILED");
    const error = execution.getError();
    expect(error?.errorType).toBe("InvalidSignatureException");
    expect(error?.errorMessage).toContain("Signature expired");
  });

  it("records the fetch as SUCCEEDED even when the service rejected the call", async () => {
    // The operation records what happened at the HTTP layer. A 403 is a response, so the
    // fetch succeeded; it is the AWS SDK above it that decides the call failed.
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const fetchOperation = runner.getOperation("get-item");

    runner.registerFetchTransport(async () => ({
      status: 403,
      body: JSON.stringify({ __type: "AccessDeniedException", message: "no" }),
    }));

    await runner.run({ payload: { tableName: "my-table", id: "abc" } });

    expect(fetchOperation.getStatus()).toBe("SUCCEEDED");
    expect(fetchOperation.getFetchDetails()?.status).toBe(403);
  });
});
