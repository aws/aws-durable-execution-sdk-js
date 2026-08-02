import { generateHandler } from "./generateHandler";
import { analyzeWorkflowPermissions } from "./analyzePermissions";
import { inferExecutionTimeoutSeconds, hasUnboundedWait } from "./timeout";
import type { DarWorkflow } from "./darModel";

const wf = (nodes: unknown[], edges: unknown[] = []): DarWorkflow =>
  ({
    darVersion: "1.0",
    name: "w",
    dependencyMode: "linear",
    nodes,
    edges,
  }) as unknown as DarWorkflow;

/**
 * Two ways declared error handling was silently discarded. Both produced output that ran
 * and looked fine, which is why no existing test caught either.
 */
describe("error handling is never silently discarded", () => {
  it("refuses a fallback on a node that binds no result", () => {
    // A wait produces nothing to fall back to, so the fallback arm emitted an EMPTY
    // catch — the error was swallowed and execution continued as though the wait had
    // succeeded.
    expect(() =>
      generateHandler(
        wf(
          [
            { id: "s", kind: "start", name: "s" },
            {
              id: "w",
              kind: "wait",
              name: "pause",
              durationValue: 5,
              durationUnit: "seconds",
              onError: [{ errorType: "", fallbackCode: "return 1;" }],
            },
            {
              id: "a",
              kind: "step",
              name: "A",
              code: "return 1;",
              terminal: true,
            },
          ],
          [
            { id: "e1", source: "s", target: "w" },
            { id: "e2", source: "w", target: "a" },
          ],
        ),
      ),
    ).toThrow(/produces no result to fall back to/);
  });

  it("never emits an empty catch block", () => {
    const code = generateHandler(
      wf(
        [
          { id: "s", kind: "start", name: "s" },
          { id: "a", kind: "step", name: "A", code: "return 1;" },
          {
            id: "r",
            kind: "step",
            name: "R",
            code: "return 2;",
            terminal: true,
          },
        ],
        [
          { id: "e1", source: "s", target: "a" },
          { id: "e2", source: "a", target: "r", kind: "error" },
        ],
      ),
    );
    expect(code).not.toMatch(/catch \(err\) \{\s*\}/);
  });

  it.each([
    [
      "an onError fallback",
      {
        id: "c",
        kind: "condition",
        name: "pick",
        code: "return 'A';",
        onError: [{ errorType: "", fallbackCode: "return 1;" }],
      },
      [] as unknown[],
    ],
    [
      "an error-kind edge",
      { id: "c", kind: "condition", name: "pick", code: "return 'A';" },
      [{ id: "e3", source: "c", target: "r", kind: "error" }],
    ],
  ])(
    "refuses a condition that declares %s",
    (_label, condition, extraEdges) => {
      // A condition is emitted as control flow and never reaches the try/catch wrapper, so
      // its declared route produced no try, no catch, and no recovery node at all.
      expect(() =>
        generateHandler(
          wf(
            [
              { id: "s", kind: "start", name: "s" },
              condition,
              {
                id: "a",
                kind: "step",
                name: "A",
                code: "return 1;",
                terminal: true,
              },
              {
                id: "r",
                kind: "step",
                name: "R",
                code: "return 2;",
                terminal: true,
              },
            ],
            [
              { id: "e1", source: "s", target: "c" },
              { id: "e2", source: "c", target: "a", match: "A" },
              ...extraEdges,
            ],
          ),
        ),
      ).toThrow(/cannot be applied/);
    },
  );

  it("still allows a plain condition and a wait error ROUTE", () => {
    expect(() =>
      generateHandler(
        wf(
          [
            { id: "s", kind: "start", name: "s" },
            { id: "c", kind: "condition", name: "pick", code: "return 'A';" },
            {
              id: "a",
              kind: "step",
              name: "A",
              code: "return 1;",
              terminal: true,
            },
          ],
          [
            { id: "e1", source: "s", target: "c" },
            { id: "e2", source: "c", target: "a", match: "A" },
          ],
        ),
      ),
    ).not.toThrow();
  });
});

/**
 * Inferred actions have to be actions that EXIST. A fictional one is either reported in a
 * warning that names nothing real, or — with grantWildcardPermissions set — rejected
 * outright by CloudFormation.
 */
describe("inferred IAM actions are real", () => {
  const actionsFrom = (code: string) =>
    analyzeWorkflowPermissions(
      wf([{ id: "a", kind: "step", name: "A", code, terminal: true }]),
    ).statements.flatMap((s) => s.actions);

  it.each([
    [
      "emr maps to elasticmapreduce",
      "@aws-sdk/client-emr",
      "ListClustersCommand",
      "elasticmapreduce:ListClusters",
    ],
    [
      "route-53 maps to route53",
      "@aws-sdk/client-route-53",
      "ListHostedZonesCommand",
      "route53:ListHostedZones",
    ],
    [
      "efs maps to elasticfilesystem",
      "@aws-sdk/client-efs",
      "DescribeFileSystemsCommand",
      "elasticfilesystem:DescribeFileSystems",
    ],
    [
      "api-gateway maps to apigateway",
      "@aws-sdk/client-api-gateway",
      "GetRestApisCommand",
      "apigateway:GetRestApis",
    ],
  ])("%s", (_label, pkg, command, expected) => {
    expect(
      actionsFrom(`const { X } = require("${pkg}"); new ${command}({});`),
    ).toContain(expected);
  });

  it("maps DocumentClient commands to the Item actions", () => {
    // lib-dynamodb's commands drop the `Item` suffix, so the strip rule produced
    // `dynamodb:Get` — not a real action.
    const actions = actionsFrom(
      `const { DynamoDBClient } = require("@aws-sdk/client-dynamodb"); new GetCommand({}); new PutCommand({});`,
    );
    expect(actions).toContain("dynamodb:GetItem");
    expect(actions).toContain("dynamodb:PutItem");
    expect(actions).not.toContain("dynamodb:Get");
  });

  it("expands CopyObject, which is not an IAM action", () => {
    const actions = actionsFrom(
      `const { S3Client } = require("@aws-sdk/client-s3"); new CopyObjectCommand({});`,
    );
    expect(actions).toContain("s3:GetObject");
    expect(actions).toContain("s3:PutObject");
    expect(actions).not.toContain("s3:CopyObject");
  });
});

/**
 * A map runs its body once per item and the item count is unknown at synth time, so
 * costing a single iteration is the same guess that a dynamic wait was deliberately
 * changed to refuse.
 */
describe("a map whose body waits is unbounded", () => {
  const mapWith = (bodyNodes: unknown[]) =>
    wf(
      [
        { id: "s", kind: "start", name: "s" },
        {
          id: "m",
          kind: "map",
          name: "M",
          itemsCode: "return input.items;",
          body: { nodes: bodyNodes, edges: [] },
          terminal: true,
        },
      ],
      [{ id: "e1", source: "s", target: "m" }],
    );

  it("propagates UNKNOWN_WAIT when the body contains a durable wait", () => {
    expect(
      hasUnboundedWait(
        mapWith([
          {
            id: "w",
            kind: "wait",
            name: "W",
            durationValue: 30,
            durationUnit: "seconds",
          },
        ]),
      ),
    ).toBe(true);
  });

  it("stays bounded when the body has no wait", () => {
    const bounded = mapWith([
      { id: "i", kind: "step", name: "In", code: "return 1;" },
    ]);
    expect(hasUnboundedWait(bounded)).toBe(false);
    expect(inferExecutionTimeoutSeconds(bounded)).toBeGreaterThan(0);
  });
});
