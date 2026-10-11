import { LambdaClient } from "@aws-sdk/client-lambda";
import { DurableExecutionApiClient } from "./durable-execution-api-client";
import { OperationAction, OperationType, OperationUpdate } from "../types/wire";

const root = "Root=1-5759e988-bd862e3fe1be46a994272793";

// This deliberately exercises the installed Lambda model's serializer, without
// mocking send/commands or manufacturing HTTP JSON. It must fail if that model
// drops XAmznTraceId. Keep the assertion while awaiting the model release.
describe("chained invoke propagation through the Lambda serializer", () => {
  it("retains per-operation headers, including Sampled=0, in one checkpoint", async () => {
    const bodies: unknown[] = [];
    const client = new LambdaClient({
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      requestHandler: {
        async handle(request: { body?: unknown }) {
          const body = request.body;
          if (typeof body !== "string" && !(body instanceof Uint8Array))
            throw new Error("expected JSON request");
          bodies.push(
            JSON.parse(
              typeof body === "string"
                ? body
                : Buffer.from(body).toString("utf8"),
            ),
          );
          return {
            response: {
              statusCode: 200,
              headers: { "content-type": "application/json" },
              body: Buffer.from('{"CheckpointToken":"next"}'),
            },
          };
        },
      },
    });
    const updates: OperationUpdate[] = ["1", "0"].map((sampled, index) => ({
      Id: `operation-${index}`,
      ParentId: "parent",
      Name: `call-${index}`,
      Type: OperationType.CHAINED_INVOKE,
      SubType: "ChainedInvoke",
      Action: OperationAction.START,
      Payload: JSON.stringify({ user: index }),
      ChainedInvokeOptions: {
        FunctionName: `callee-${index}:1`,
        TenantId: "tenant",
        XAmznTraceId: `${root};Parent=${index === 0 ? "1111111111111111" : "2222222222222222"};Sampled=${sampled}`,
      },
    }));
    updates.push({
      Id: "without-plugin",
      Type: OperationType.CHAINED_INVOKE,
      Action: OperationAction.START,
      ChainedInvokeOptions: { FunctionName: "fallback:1" },
    });
    try {
      await expect(
        new DurableExecutionApiClient(client).checkpoint({
          DurableExecutionArn:
            "arn:aws:lambda:us-east-1:123456789012:function:parent:1/durable-execution/test/1",
          CheckpointToken: "token",
          ClientToken: "client-token",
          Updates: updates,
        }),
      ).resolves.toMatchObject({ CheckpointToken: "next" });
      expect(bodies).toEqual([
        {
          CheckpointToken: "token",
          ClientToken: "client-token",
          Updates: updates,
        },
      ]);
    } finally {
      client.destroy();
    }
  });
});
