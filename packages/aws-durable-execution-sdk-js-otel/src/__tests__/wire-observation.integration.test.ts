import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Context } from "aws-lambda";
import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { ExecutionOtelPlugin } from "../execution-plugin";
import {
  NodeTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import {
  withDurableExecution,
  OperationType,
  OperationStatus,
} from "@aws/durable-execution-sdk-js";

it("observes the actual default-client wire without logging payload or tokens", async () => {
  const saved = Object.fromEntries(
    [
      "AWS_REGION",
      "AWS_ENDPOINT_URL_LAMBDA",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_PROFILE",
      "AWS_DEFAULT_PROFILE",
    ].map((key) => [key, process.env[key]]),
  );
  const messages = jest
    .spyOn(console, "info")
    .mockImplementation(() => undefined);
  const bodies: Array<{
    CheckpointToken?: string;
    Updates?: Array<{
      Id: string;
      Type: string;
      SubType?: string;
      Name?: string;
      Payload?: string;
    }>;
  }> = [];
  const start = new Date("2026-01-01T00:00:00Z");
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk.toString();
    const body = JSON.parse(raw);
    bodies.push(body);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        CheckpointToken: "next",
        NewExecutionState: {
          Operations: (body.Updates ?? []).map(
            (update: {
              Id: string;
              Type: string;
              SubType?: string;
              Name?: string;
              Payload?: string;
            }) => ({
              Id: update.Id,
              Type: update.Type,
              SubType: update.SubType,
              Name: update.Name,
              Status: "SUCCEEDED",
              StartTimestamp: start.getTime() / 1000,
              EndTimestamp: start.getTime() / 1000 + 1,
              ChainedInvokeDetails: { Result: update.Payload },
            }),
          ),
        },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_ENDPOINT_URL_LAMBDA = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";
  delete process.env.AWS_SESSION_TOKEN;
  delete process.env.AWS_PROFILE;
  delete process.env.AWS_DEFAULT_PROFILE;
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  const exporter = new InMemorySpanExporter();
  let provider!: NodeTracerProvider;
  const plugin = new ExecutionOtelPlugin({
    contextExtractor: () => undefined,
    tracerProviderFactory: (ids) =>
      (provider = new NodeTracerProvider({
        idGenerator: ids(),
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      })),
  });
  const lambdaContext: Context = {
    awsRequestId: "request",
    getRemainingTimeInMillis: () => 0,
    callbackWaitsForEmptyEventLoop: false,
    functionName: "parent",
    functionVersion: "1",
    invokedFunctionArn: "parent:1",
    memoryLimitInMB: "128",
    logGroupName: "group",
    logStreamName: "stream",
    done() {},
    fail() {},
    succeed() {},
  };
  try {
    const handler = withDurableExecution(
      async (_event, ctx) =>
        ctx.invoke("wire-call", "callee:1", { value: "DO_NOT_LOG_PAYLOAD" }),
      { plugins: [plugin] },
    );
    const result = await handler(
      {
        DurableExecutionArn:
          "arn:aws:lambda:us-east-1:123456789012:function:parent:1/durable-execution/wire/1",
        CheckpointToken: "DO_NOT_LOG_CHECKPOINT_TOKEN",
        InitialExecutionState: {
          Operations: [
            {
              Id: "execution",
              Type: OperationType.EXECUTION,
              Status: OperationStatus.STARTED,
              StartTimestamp: start,
              ExecutionDetails: { InputPayload: "{}" },
            },
          ],
        },
      },
      lambdaContext,
    );
    expect(result).toMatchObject({
      Status: "SUCCEEDED",
      Result: '{"value":"DO_NOT_LOG_PAYLOAD"}',
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].CheckpointToken).toBe("DO_NOT_LOG_CHECKPOINT_TOKEN");
    expect(bodies[0].Updates?.[0].Payload).toBe(
      '{"value":"DO_NOT_LOG_PAYLOAD"}',
    );
    const lines = messages.mock.calls
      .map((call) => call[0])
      .filter(
        (value): value is string =>
          typeof value === "string" &&
          value.startsWith("CHAIN_WIRE_OBSERVATION "),
      );
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("DO_NOT_LOG");
    expect(lines[0]).not.toContain("CheckpointToken");
    expect(lines[0]).not.toContain("ClientToken");
    const row = JSON.parse(lines[0].slice("CHAIN_WIRE_OBSERVATION ".length));
    const span = exporter
      .getFinishedSpans()
      .find((span) => span.name === "wire-call")!;
    expect(row.dtoHeader).toBe(row.wireHeader);
    expect(row.wireHeader).toBe(
      `Root=1-${span.spanContext().traceId.slice(0, 8)}-${span.spanContext().traceId.slice(8)};Parent=${span.spanContext().spanId};Sampled=1`,
    );
    expect(row.operationId).toBe(row.wireOperationId);
    expect(row.operationName).toBe("wire-call");
  } finally {
    server.closeAllConnections();
    await provider.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    context.disable();
    messages.mockRestore();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}, 30_000);
