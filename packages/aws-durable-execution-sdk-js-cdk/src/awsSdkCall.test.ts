import { generateHandler } from "./generateHandler";
import { analyzeWorkflowPermissions } from "./analyzePermissions";
import type { DarWorkflow } from "./darModel";

function wf(nodeExtra: Record<string, unknown>): DarWorkflow {
  return {
    darVersion: "1",
    name: "sdk-call-wf",
    nodes: [
      { id: "n1", kind: "awsSdkCall", name: "put-item", ...nodeExtra },
    ] as never,
    edges: [],
  };
}

describe("awsSdkCall codegen", () => {
  const node = {
    clientPackage: "@aws-sdk/client-dynamodb",
    clientClass: "DynamoDBClient",
    command: "PutItemCommand",
    input: '{ "TableName": "t", "Item": {} }',
  };

  it("emits a durable step that news up the client and sends the command", () => {
    const code = generateHandler(wf(node));
    expect(code).toContain(
      'import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";',
    );
    expect(code).toContain("new DynamoDBClient({})");
    expect(code).toContain("new PutItemCommand(");
    expect(code).toContain('context.step("put-item"');
  });

  it("honors a region override", () => {
    const code = generateHandler(wf({ ...node, region: "us-east-2" }));
    expect(code).toContain('new DynamoDBClient({ region: "us-east-2" })');
  });

  it("throws a clear error when required fields are missing", () => {
    expect(() => generateHandler(wf({ command: "PutItemCommand" }))).toThrow(
      /missing clientPackage/,
    );
  });

  it("infers service:Action IAM for the call", () => {
    const res = analyzeWorkflowPermissions(wf(node));
    const actions = res.statements.flatMap(
      (s: { actions: string[] }) => s.actions,
    );
    expect(actions).toContain("dynamodb:PutItem");
  });

  it("applies IAM action overrides (lambda:Invoke -> InvokeFunction)", () => {
    const res = analyzeWorkflowPermissions(
      wf({
        clientPackage: "@aws-sdk/client-lambda",
        clientClass: "LambdaClient",
        command: "InvokeCommand",
        input: "{}",
      }),
    );
    const actions = res.statements.flatMap(
      (s: { actions: string[] }) => s.actions,
    );
    expect(actions).toContain("lambda:InvokeFunction");
  });
});
