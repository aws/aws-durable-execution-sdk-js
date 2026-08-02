import { analyzeWorkflowPermissions } from "./analyzePermissions";
import type { DarWorkflow } from "./darModel";

const wf = (nodes: unknown[]): DarWorkflow =>
  ({
    darVersion: "1.0",
    name: "w",
    nodes: nodes as never,
    edges: [],
  }) as DarWorkflow;

describe("analyzeWorkflowPermissions", () => {
  it("maps client-lambda InvokeCommand to lambda:InvokeFunction (not lambda:Invoke)", () => {
    const a = analyzeWorkflowPermissions(
      wf([
        {
          id: "n1",
          kind: "step",
          name: "invoke",
          code: `const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
                 const c = new LambdaClient({});
                 await c.send(new InvokeCommand({ FunctionName: "fn", Payload: "{}" }));
                 return {};`,
        },
      ]),
    );
    const lambda = a.statements.find((s) => s.source.startsWith("lambda"));
    expect(lambda?.actions).toContain("lambda:InvokeFunction");
    expect(lambda?.actions).not.toContain("lambda:Invoke");
  });

  it("infers S3 actions from destructured v3 usage", () => {
    const a = analyzeWorkflowPermissions(
      wf([
        {
          id: "n1",
          kind: "step",
          name: "store",
          code: `const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
                 const c = new S3Client({});
                 await c.send(new PutObjectCommand({ Bucket: "b", Key: "k", Body: "x" }));
                 return {};`,
        },
      ]),
    );
    const s3 = a.statements.find((s) => s.source.startsWith("s3"));
    expect(s3?.actions).toContain("s3:PutObject");
    expect(s3?.resources).toEqual(["*"]);
  });

  it("applies action overrides (ListObjectsV2 -> s3:ListBucket)", () => {
    const a = analyzeWorkflowPermissions(
      wf([
        {
          id: "n1",
          kind: "step",
          name: "list",
          code: `import { ListObjectsV2Command } from "@aws-sdk/client-s3";
                 return new ListObjectsV2Command({});`,
        },
      ]),
    );
    const s3 = a.statements.find((s) => s.source.startsWith("s3"));
    expect(s3?.actions).toContain("s3:ListBucket");
  });

  it("maps bedrock-runtime to the bedrock service prefix", () => {
    const a = analyzeWorkflowPermissions(
      wf([
        {
          id: "n1",
          kind: "step",
          name: "ai",
          code: `const { InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime"); new InvokeModelCommand({});`,
        },
      ]),
    );
    expect(
      a.statements.find((s) => s.source.startsWith("bedrock"))?.actions,
    ).toContain("bedrock:InvokeModel");
  });

  it("grants lambda:InvokeFunction for chainInvoke on the target ARN", () => {
    const arn = "arn:aws:lambda:us-east-1:1:function:child:$LATEST";
    const a = analyzeWorkflowPermissions(
      wf([{ id: "n1", kind: "chainInvoke", name: "call", functionArn: arn }]),
    );
    const inv = a.statements.find((s) =>
      s.actions.includes("lambda:InvokeFunction"),
    );
    expect(inv?.resources).toEqual([arn]);
  });

  it("recurses into map bodies and dedupes actions", () => {
    const a = analyzeWorkflowPermissions(
      wf([
        {
          id: "m",
          kind: "map",
          name: "each",
          body: {
            darVersion: "1.0",
            name: "b",
            edges: [],
            nodes: [
              {
                id: "s",
                kind: "step",
                name: "put",
                code: `const { PutObjectCommand } = require("@aws-sdk/client-s3"); new PutObjectCommand({});`,
              },
            ],
          },
        },
      ]),
    );
    expect(
      a.statements.find((s) => s.source.startsWith("s3"))?.actions,
    ).toEqual(["s3:PutObject"]);
  });

  it("warns when a command can't be attributed to a service", () => {
    const a = analyzeWorkflowPermissions(
      wf([
        {
          id: "n1",
          kind: "step",
          name: "amb",
          code: `require("@aws-sdk/client-s3"); require("@aws-sdk/client-dynamodb"); new GetItemCommand({});`,
        },
      ]),
    );
    expect(a.warnings.some((w) => w.includes("GetItemCommand"))).toBe(true);
  });

  it("returns nothing for a workflow with no AWS usage", () => {
    const a = analyzeWorkflowPermissions(
      wf([{ id: "n1", kind: "step", name: "pure", code: "return event;" }]),
    );
    expect(a.statements).toEqual([]);
    expect(a.warnings).toEqual([]);
  });
});
