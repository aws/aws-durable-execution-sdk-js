import {
  parseDarTs,
  workflowToDarTs,
  isDarTsFile,
  workflowFileToJsonText,
} from "./darTs";
import type { JsonWorkflow } from "./darTs";

const model: JsonWorkflow = {
  darVersion: "1.0",
  name: "orders",
  comment: "End-to-end order pipeline",
  dependencyMode: "linear",
  inputType: "{ orderId: string }",
  layoutDirection: "LR",
  nodes: [
    { id: "s", kind: "start", name: "start", position: { x: 60, y: 40 } },
    {
      id: "n1",
      kind: "step",
      name: "fetch-user",
      comment: "Loads the user record",
      position: { x: 60, y: 170 },
      code: "const u = await db.get(event.orderId);\nreturn u;",
      resultType: "{ status: string }",
      retry: {
        kind: "exponential",
        maxAttempts: 3,
        initialDelaySeconds: 5,
        maxDelaySeconds: 300,
        backoffRate: 2,
        incrementSeconds: 1,
        jitter: "FULL",
      },
    },
    {
      id: "n2",
      kind: "condition",
      name: "decide",
      position: { x: 60, y: 300 },
      code: "return fetch_user.status;",
    },
    {
      id: "m1",
      kind: "map",
      name: "process-items",
      position: { x: 240, y: 300 },
      itemsCode: "return input.items;",
      maxConcurrency: 5,
      body: {
        darVersion: "1.0",
        name: "body",
        nodes: [
          { id: "bs", kind: "start", name: "start", position: { x: 0, y: 0 } },
          {
            id: "v1",
            kind: "step",
            name: "validate",
            position: { x: 0, y: 130 },
            code: "return check(item);",
            retry: {
              kind: "none",
              maxAttempts: 1,
              initialDelaySeconds: 1,
              maxDelaySeconds: 1,
              backoffRate: 1,
              incrementSeconds: 1,
              jitter: "NONE",
            },
          },
        ],
        edges: [{ id: "be1", source: "bs", target: "v1" }],
      },
    },
    {
      id: "h",
      kind: "step",
      name: "on-error",
      position: { x: 400, y: 300 },
      code: "return recover(err);",
      retry: {
        kind: "none",
        maxAttempts: 1,
        initialDelaySeconds: 1,
        maxDelaySeconds: 1,
        backoffRate: 1,
        incrementSeconds: 1,
        jitter: "NONE",
      },
    },
  ],
  edges: [
    { id: "e1", source: "s", target: "n1" },
    { id: "e2", source: "n1", target: "n2" },
    { id: "e3", source: "n2", target: "m1", match: "PAID" },
    { id: "err1", source: "n1", target: "h", kind: "error", errorType: "Boom" },
  ],
};

describe("workflowToDarTs", () => {
  const text = workflowToDarTs(model);

  it("emits functions, flat child consts, exported root, trailing layout", () => {
    expect(text).toContain("async function fetch_user(");
    expect(text).toContain("function decide(");
    expect(text).toContain("async function validate(");
    expect(text).toContain("const process_itemsBody =");
    expect(text).toContain("export const workflow =");
    expect(text.trimEnd().endsWith("};")).toBe(true);
    expect(text).toContain("export const meta =");
    // children before root, layout last
    expect(text.indexOf("process_itemsBody")).toBeLessThan(
      text.indexOf("export const workflow"),
    );
    expect(text.indexOf("export const workflow")).toBeLessThan(
      text.indexOf("export const meta"),
    );
  });

  it("encodes scope as parameters", () => {
    // condition sees the upstream step result
    expect(text).toMatch(
      /function decide\(.*fetch_user: \(\{ status: string \}\)/,
    );
    // root code sees event/input typed by inputType
    expect(text).toMatch(/fetch_user\(.*event: \(\{ orderId: string \}\)/);
    // map body code sees item/index, not event
    expect(text).toMatch(
      /function validate\(item: \(any\), index: \(number\)\)/,
    );
    // error-route target sees err
    expect(text).toMatch(/function on_error\(err: unknown/);
  });

  it("keeps positions out of the definition literal", () => {
    expect(text).not.toContain('"position"');
    expect(text).toContain('"s": [60, 40],');
  });

  // Regression: a dagContainer node carries a nested `body` scope just like
  // map/group. If `visit` doesn't register that scope, `emitWorkflowConst`
  // throws "internal: unregistered child workflow" when it hits the body
  // reference — which surfaced as the code view refusing to open once a DAG
  // Container node was dropped onto the canvas.
  it("registers the body scope of a dagContainer node", () => {
    const wf: JsonWorkflow = {
      darVersion: "1.0",
      name: "with-dag",
      dependencyMode: "linear",
      layoutDirection: "TB",
      nodes: [
        { id: "s", kind: "start", name: "start", position: { x: 0, y: 0 } },
        {
          id: "dc",
          kind: "dagContainer",
          name: "my-dag",
          position: { x: 0, y: 130 },
          body: {
            darVersion: "1.0",
            name: "dagBody",
            dependencyMode: "dag",
            nodes: [
              {
                id: "t1",
                kind: "step",
                name: "task-one",
                position: { x: 0, y: 0 },
                code: "return 1;",
              },
            ],
            edges: [],
          },
        },
      ],
      edges: [{ id: "e1", source: "s", target: "dc" }],
    };
    let out = "";
    expect(() => {
      out = workflowToDarTs(wf);
    }).not.toThrow();
    // the container's body is emitted as its own flat const, before the root
    expect(out).toContain("const my_dagBody =");
    expect(out).toContain("async function task_one(");
    expect(out.indexOf("my_dagBody")).toBeLessThan(
      out.indexOf("export const workflow"),
    );
  });
});

describe("parseDarTs round-trip", () => {
  const back = parseDarTs(workflowToDarTs(model));

  it("restores code bodies, structure, edges and layout", () => {
    const n1 = back.nodes.find((n) => n.id === "n1")!;
    expect(n1.code).toBe("const u = await db.get(event.orderId);\nreturn u;");
    expect(n1.position).toEqual({ x: 60, y: 170 });
    expect((n1.retry as { maxAttempts: number }).maxAttempts).toBe(3);
    const m1 = back.nodes.find((n) => n.id === "m1")!;
    const body = m1.body as JsonWorkflow;
    expect(body.nodes.find((n) => n.id === "v1")!.code).toBe(
      "return check(item);",
    );
    expect(back.edges).toEqual(model.edges);
    expect(back.layoutDirection).toBe("LR");
    expect(back.inputType).toBe("{ orderId: string }");
    expect(back.comment).toBe("End-to-end order pipeline");
    expect(n1.comment).toBe("Loads the user record");
  });

  it("round-trips the meta.deploy deployment record", () => {
    const deployed: JsonWorkflow = {
      ...model,
      deploy: {
        functionName: "orders-fn",
        region: "us-east-2",
        deployedAt: "2026-07-24T20:00:00.000Z",
      },
    };
    const text = workflowToDarTs(deployed);
    // Inside the single trailing meta object, alongside layout.
    expect(text).toContain("deploy: {");
    expect(text).toContain('functionName: "orders-fn"');
    const again = parseDarTs(text);
    expect(again.deploy).toEqual(deployed.deploy);
    // A never-deployed workflow has no deploy block at all.
    expect(workflowToDarTs(model)).not.toContain("deploy: {");
    expect(parseDarTs(workflowToDarTs(model)).deploy).toBeUndefined();
  });
});

describe("parseDarTs errors", () => {
  it("rejects executed/unsupported expressions in the literal", () => {
    expect(() =>
      parseDarTs(
        'export const workflow = { name: "x", nodes: [], edges: [], evil: doThing() };',
      ),
    ).toThrow(/unsupported expression/);
  });

  it("rejects spreads", () => {
    expect(() =>
      parseDarTs("export const workflow = { ...base, nodes: [], edges: [] };"),
    ).toThrow(/plain `key: value`/);
  });

  it("rejects unknown top-level statements", () => {
    expect(() =>
      parseDarTs(
        'console.log("hi");\nexport const workflow = { name: "x", nodes: [], edges: [] };',
      ),
    ).toThrow(/top level/);
  });

  it("rejects unknown code references", () => {
    expect(() =>
      parseDarTs(
        'export const workflow = { name: "x", nodes: [{ id: "a", kind: "step", name: "a", code: nope }], edges: [] };',
      ),
    ).toThrow(/unknown code function/);
  });

  it("requires an exported definition", () => {
    expect(() =>
      parseDarTs('const wf = { name: "x", nodes: [], edges: [] };'),
    ).toThrow(/no exported workflow/);
  });
});

describe("isDarTsFile", () => {
  it("matches only the .dar.ts suffix", () => {
    expect(isDarTsFile("/a/b/orders.dar.ts")).toBe(true);
    expect(isDarTsFile("/a/b/orders.dar")).toBe(false);
    expect(isDarTsFile("/a/b/orders.ts")).toBe(false);
  });
});

describe("workflowFileToJsonText", () => {
  it("passes legacy JSON content through regardless of filename", () => {
    const json = '{ "name": "x", "nodes": [], "edges": [] }';
    expect(workflowFileToJsonText(json)).toBe(json);
  });

  it("parses .dar.ts content to JSON model text", () => {
    const ts = workflowToDarTs(model);
    const back = JSON.parse(workflowFileToJsonText(ts));
    expect(back.name).toBe("orders");
    expect(
      back.nodes.find((n: { id: string }) => n.id === "n1").code,
    ).toContain("db.get(event.orderId)");
  });
});

/**
 * `.dar.ts` is the deploy artifact, so anything the serializer drops changes
 * execution semantics on the next save+redeploy. The workflow-level fields were
 * previously built from a fixed allowlist, which discarded `dagConfig` (it drives
 * defaultTriggerRule / nesting / concurrency in the emitted `context.dag(...)`)
 * along with every field a newer Studio might add — contradicting the forward
 * compatibility promised in dar-specification.md.
 */
describe("workflow-level field preservation", () => {
  const wf = (extra: Record<string, unknown>): JsonWorkflow =>
    ({
      darVersion: "1.0",
      name: "w",
      dependencyMode: "dag",
      layoutDirection: "LR",
      ...extra,
      nodes: [
        {
          id: "t1",
          kind: "step",
          name: "t",
          code: "return 1;",
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    }) as never;

  it("round-trips workflow-level dagConfig", () => {
    const dagConfig = {
      maxConcurrency: 4,
      defaultTriggerRule: "ALL_SUCCESS",
      nesting: "NESTED",
    };
    const back = parseDarTs(
      workflowToDarTs(wf({ dagConfig })),
    ) as unknown as Record<string, unknown>;
    expect(back.dagConfig).toEqual(dagConfig);
  });

  it("round-trips fields it does not know about", () => {
    const someFutureField = { a: 1, b: ["x"], c: null };
    const back = parseDarTs(
      workflowToDarTs(wf({ someFutureField })),
    ) as unknown as Record<string, unknown>;
    expect(back.someFutureField).toEqual(someFutureField);
  });

  it("still quarantines layout and deploy in meta, not the definition", () => {
    const text = workflowToDarTs(
      wf({ deploy: { functionName: "f", region: "us-east-1" } }),
    );
    const def = text.slice(0, text.indexOf("export const meta"));
    expect(def).not.toContain("layoutDirection");
    expect(def).not.toContain("functionName");
    expect(text).toContain("export const meta");
    // …and they survive the round trip via meta.
    const back = parseDarTs(text) as unknown as Record<string, unknown>;
    expect(back.layoutDirection).toBe("LR");
    expect(back.deploy).toMatchObject({ functionName: "f" });
  });
});

/**
 * The workflow-level loop preserves unknown fields deliberately, for forward
 * compatibility. Per-branch fields used an id/name/body allowlist, so anything else
 * present on parse was dropped on the next save — a lossy round-trip through Studio
 * for any branch field this version happens not to know.
 */
describe("parallel branch fields survive a round trip", () => {
  it("keeps a field this version does not know about", () => {
    const wf = {
      darVersion: "1",
      name: "w",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "p",
          kind: "parallel",
          name: "P",
          terminal: true,
          branches: [
            {
              id: "b1",
              name: "b1",
              futureField: { keep: "me" },
              body: {
                nodes: [
                  { id: "i", kind: "step", name: "In", code: "return 1;" },
                ],
                edges: [],
              },
            },
          ],
        },
      ],
      edges: [{ id: "e", source: "s", target: "p" }],
    } as unknown as JsonWorkflow;

    const text = workflowToDarTs(wf);
    expect(text).toContain("futureField");
    const back = parseDarTs(text) as unknown as JsonWorkflow;
    const branch = (
      back.nodes.find((n) => n.id === "p") as unknown as {
        branches: Record<string, unknown>[];
      }
    ).branches[0];
    expect(branch.futureField).toEqual({ keep: "me" });
    // and the known fields still work
    expect(branch.id).toBe("b1");
    expect(branch.body).toBeDefined();
  });
});
