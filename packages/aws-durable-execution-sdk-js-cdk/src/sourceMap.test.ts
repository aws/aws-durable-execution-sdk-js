import { parseWorkflow } from "./darModel";
import { generateHandler } from "./generateHandler";
import {
  generateHandlerWithMap,
  locateDarTsFunctionBodyLines,
  locateDarTsNodeLines,
  locateDarTsNodeSourceLines,
  darTsNodeIdForLine,
} from "./sourceMap";
import { SourceMapConsumer } from "source-map";

// A small multi-node workflow exercising: step, wait, condition (two
// branches) — enough to confirm the map attributes each generated line to
// the right .dar.ts function body LINE (not just the right node), matching
// the .dar.ts format's genuine multi-line function declarations.
const DAR_JSON = `{
  "darVersion": "1.0",
  "name": "SourceMapFixture",
  "dependencyMode": "linear",
  "nodes": [
    { "id": "start", "kind": "start", "name": "Start" },
    {
      "id": "Fetch_Data",
      "kind": "step",
      "name": "Fetch Data",
      "code": "const value = 42;\\nreturn { value };"
    },
    {
      "id": "Decide",
      "kind": "condition",
      "name": "Decide",
      "code": "return Fetch_Data.value > 10 ? \\"big\\" : \\"small\\";"
    },
    {
      "id": "Handle_Big",
      "kind": "step",
      "name": "Handle Big",
      "terminal": true,
      "code": "const label = \\"BIG\\";\\nreturn { outcome: label };"
    }
  ],
  "edges": [
    { "id": "e0", "source": "start", "target": "Fetch_Data" },
    { "id": "e1", "source": "Fetch_Data", "target": "Decide" },
    { "id": "e2", "source": "Decide", "target": "Handle_Big", "match": "big" }
  ]
}`;

// The corresponding hand-written .dar.ts (matches dar-ts-specification.md's
// §2/§3 shape: one named function per code-bearing field, function name =
// toIdentifier(node.name) exactly). Real, separate, multi-line functions —
// the whole point of targeting .dar.ts instead of the JSON .dar.
const DAR_TS = `async function Fetch_Data() {
  const value = 42;
  return { value };
}

function Decide(Fetch_Data: any) {
  return Fetch_Data.value > 10 ? "big" : "small";
}

async function Handle_Big() {
  const label = "BIG";
  return { outcome: label };
}

export const workflow = {
  darVersion: "1.0",
  name: "SourceMapFixture",
  dependencyMode: "linear",
  nodes: [
    { id: "start", kind: "start", name: "Start" },
    { id: "Fetch_Data", kind: "step", name: "Fetch Data", code: Fetch_Data },
    { id: "Decide", kind: "condition", name: "Decide", code: Decide },
    {
      id: "Handle_Big",
      kind: "step",
      name: "Handle Big",
      terminal: true,
      code: Handle_Big,
    },
  ],
  edges: [
    { id: "e0", source: "start", target: "Fetch_Data" },
    { id: "e1", source: "Fetch_Data", target: "Decide" },
    { id: "e2", source: "Decide", target: "Handle_Big", match: "big" },
  ],
};

export const meta = {
  layout: {
    direction: "TB",
    positions: {},
  },
};
`;

describe("generateHandlerWithMap (.dar.ts targeting)", () => {
  const wf = parseWorkflow(JSON.parse(DAR_JSON));

  it("returns handler code byte-identical to generateHandler's own output", () => {
    const plain = generateHandler(wf);
    const { code } = generateHandlerWithMap(
      wf,
      DAR_TS,
      "sourceMapFixture.dar.ts",
    );
    expect(code).toBe(plain);
    expect(code).not.toContain("@dar:");
    expect(plain).not.toContain("@dar:");
  });

  it("locates each function's real multi-line body lines in the .dar.ts text", () => {
    const lines = locateDarTsFunctionBodyLines(DAR_TS);
    // Line numbers verified directly against DAR_TS above (1-based).
    // Fetch_Data's body: "  const value = 42;" (line 2), "  return { value };" (line 3).
    expect(lines.get("Fetch_Data")).toEqual([2, 3]);
    // Decide's body: one line (line 7).
    expect(lines.get("Decide")).toEqual([7]);
    // Handle_Big's body: two lines (lines 11, 12).
    expect(lines.get("Handle_Big")).toEqual([11, 12]);
  });

  it("maps each generated line inside a multi-line step body to the CORRESPONDING .dar.ts line, not just the same one (statement-level granularity)", async () => {
    const { code, map } = generateHandlerWithMap(
      wf,
      DAR_TS,
      "sourceMapFixture.dar.ts",
    );
    const consumer = await new SourceMapConsumer(JSON.parse(map));
    const lines = code.split("\n");

    const valueLineIdx = lines.findIndex((l) => l.includes("const value = 42"));
    const returnLineIdx = lines.findIndex((l) =>
      l.includes("return { value }"),
    );
    expect(valueLineIdx).toBeGreaterThan(-1);
    expect(returnLineIdx).toBeGreaterThan(valueLineIdx);

    const posA = consumer.originalPositionFor({
      line: valueLineIdx + 1,
      column: 0,
    });
    const posB = consumer.originalPositionFor({
      line: returnLineIdx + 1,
      column: 0,
    });
    // Different generated lines within the SAME node's body now map to
    // DIFFERENT .dar.ts lines — the JSON-targeting version could only ever
    // give both the same position (node-start only).
    expect(posA.line).toBe(2);
    expect(posB.line).toBe(3);
    expect(posA.source).toBe("sourceMapFixture.dar.ts");
    expect(posB.source).toBe("sourceMapFixture.dar.ts");
  });

  it("also gives statement-level granularity for a second node, confirming per-node line tracking resets correctly", async () => {
    const { code, map } = generateHandlerWithMap(
      wf,
      DAR_TS,
      "sourceMapFixture.dar.ts",
    );
    const consumer = await new SourceMapConsumer(JSON.parse(map));
    const lines = code.split("\n");

    const labelLineIdx = lines.findIndex((l) => l.includes('label = "BIG"'));
    const outcomeLineIdx = lines.findIndex((l) => l.includes("outcome: label"));
    expect(labelLineIdx).toBeGreaterThan(-1);
    expect(outcomeLineIdx).toBeGreaterThan(labelLineIdx);

    const posA = consumer.originalPositionFor({
      line: labelLineIdx + 1,
      column: 0,
    });
    const posB = consumer.originalPositionFor({
      line: outcomeLineIdx + 1,
      column: 0,
    });
    expect(posA.line).toBe(11);
    expect(posB.line).toBe(12);
  });

  it("embeds the full .dar.ts text as sourcesContent so a debugger never needs a separate fetch", async () => {
    const { map } = generateHandlerWithMap(
      wf,
      DAR_TS,
      "sourceMapFixture.dar.ts",
    );
    const consumer = await new SourceMapConsumer(JSON.parse(map));
    expect(consumer.sourceContentFor("sourceMapFixture.dar.ts")).toBe(DAR_TS);
  });
});

// A workflow exercising NODE-level mapping specifically: a start, a wait
// (no code body), a step (has a code body), and a map whose body contains a
// nested step — so we can confirm operation-entry breakpoints resolve to each
// node's DECLARATION line, including a node inside a container body.
const NODE_DAR_JSON = `{
  "darVersion": "1.0",
  "name": "NodeMapFixture",
  "dependencyMode": "linear",
  "nodes": [
    { "id": "start", "kind": "start", "name": "Start" },
    {
      "id": "Pause",
      "kind": "wait",
      "name": "Pause",
      "durationUnit": "seconds",
      "durationValue": 5
    },
    {
      "id": "Fetch_Data",
      "kind": "step",
      "name": "Fetch Data",
      "code": "const value = 42;\\nreturn { value };"
    },
    {
      "id": "Process_Items",
      "kind": "map",
      "name": "Process Items",
      "itemsCode": "return [1, 2, 3];",
      "body": {
        "darVersion": "1.0",
        "name": "Process Items Body",
        "nodes": [
          { "id": "inner_start", "kind": "start", "name": "Inner Start" },
          {
            "id": "Handle_Item",
            "kind": "step",
            "name": "Handle Item",
            "code": "return item * 2;"
          }
        ],
        "edges": [
          { "id": "ie0", "source": "inner_start", "target": "Handle_Item" }
        ]
      }
    }
  ],
  "edges": [
    { "id": "e0", "source": "start", "target": "Pause" },
    { "id": "e1", "source": "Pause", "target": "Fetch_Data" },
    { "id": "e2", "source": "Fetch_Data", "target": "Process_Items" }
  ]
}`;

// Corresponding hand-written .dar.ts. Line numbers are hand-counted below and
// asserted against directly. Child workflows are flat top-level consts
// (`Process_ItemsBody`), exactly as `workflowToDarTs` emits them. The
// `Process_Items` node object is deliberately spread across multiple lines so
// its `id:` property is NOT on the object's opening line — proving we record
// the id-property line, not the node-object start line.
const NODE_DAR_TS = `async function Fetch_Data() {
  const value = 42;
  return { value };
}

async function Handle_Item(item: any, index: number) {
  return item * 2;
}

const Process_ItemsBody = {
  darVersion: "1.0",
  name: "Process Items Body",
  nodes: [
    { id: "inner_start", kind: "start", name: "Inner Start" },
    { id: "Handle_Item", kind: "step", name: "Handle Item", code: Handle_Item },
  ],
  edges: [
    { id: "ie0", source: "inner_start", target: "Handle_Item" },
  ],
};

export const workflow = {
  darVersion: "1.0",
  name: "NodeMapFixture",
  dependencyMode: "linear",
  nodes: [
    { id: "start", kind: "start", name: "Start" },
    { id: "Pause", kind: "wait", name: "Pause", durationUnit: "seconds", durationValue: 5 },
    { id: "Fetch_Data", kind: "step", name: "Fetch Data", code: Fetch_Data },
    {
      id: "Process_Items",
      kind: "map",
      name: "Process Items",
      itemsCode: "return [1, 2, 3];",
      body: Process_ItemsBody,
    },
  ],
  edges: [
    { id: "e0", source: "start", target: "Pause" },
    { id: "e1", source: "Pause", target: "Fetch_Data" },
    { id: "e2", source: "Fetch_Data", target: "Process_Items" },
  ],
};

export const meta = {
  layout: {
    direction: "TB",
    positions: {},
  },
};
`;

describe("locateDarTsNodeLines / node-level breakpoint mapping", () => {
  const wf = parseWorkflow(JSON.parse(NODE_DAR_JSON));

  it("locates each node's `id:` declaration line (1-based), across the root workflow AND a nested map body", () => {
    const nodeLines = locateDarTsNodeLines(NODE_DAR_TS);
    // Verified directly against NODE_DAR_TS line numbers above.
    // Root workflow nodes:
    expect(nodeLines.get("start")).toBe(27);
    expect(nodeLines.get("Pause")).toBe(28);
    expect(nodeLines.get("Fetch_Data")).toBe(29);
    // The `Process_Items` object opens on line 30, but its `id:` is line 31 —
    // we record the id-property line, not the object-start line.
    expect(nodeLines.get("Process_Items")).toBe(31);
    // Nested map-body nodes (flat top-level const `Process_ItemsBody`):
    expect(nodeLines.get("inner_start")).toBe(14);
    expect(nodeLines.get("Handle_Item")).toBe(15);
    // No spurious extra entries.
    expect(nodeLines.size).toBe(6);
  });

  it("resolves the wait node's generated `ctx.wait` line to the wait node's .dar.ts declaration line", async () => {
    const { code, map } = generateHandlerWithMap(
      wf,
      NODE_DAR_TS,
      "nodeMapFixture.dar.ts",
    );
    const consumer = await new SourceMapConsumer(JSON.parse(map));
    const lines = code.split("\n");

    const waitLineIdx = lines.findIndex((l) =>
      l.includes('context.wait("Pause"'),
    );
    expect(waitLineIdx).toBeGreaterThan(-1);

    const pos = consumer.originalPositionFor({
      line: waitLineIdx + 1,
      column: 0,
    });
    expect(pos.line).toBe(28); // Pause's `id:` declaration line
    expect(pos.source).toBe("nodeMapFixture.dar.ts");
  });

  it("preserves the step's BODY-line mapping AND adds a wrapper-line mapping to the step's node declaration", async () => {
    const { code, map } = generateHandlerWithMap(
      wf,
      NODE_DAR_TS,
      "nodeMapFixture.dar.ts",
    );
    const consumer = await new SourceMapConsumer(JSON.parse(map));
    const lines = code.split("\n");

    // (existing behavior) a body statement still maps to its .dar.ts body line
    const bodyLineIdx = lines.findIndex((l) => l.includes("const value = 42"));
    expect(bodyLineIdx).toBeGreaterThan(-1);
    const bodyPos = consumer.originalPositionFor({
      line: bodyLineIdx + 1,
      column: 0,
    });
    expect(bodyPos.line).toBe(2); // Fetch_Data function body, first line

    // (new behavior) the `await ctx.step(...)` wrapper maps to the NODE decl
    const wrapperLineIdx = lines.findIndex((l) =>
      l.includes('context.step("Fetch Data"'),
    );
    expect(wrapperLineIdx).toBeGreaterThan(-1);
    expect(wrapperLineIdx).toBeLessThan(bodyLineIdx); // wrapper precedes body
    const wrapperPos = consumer.originalPositionFor({
      line: wrapperLineIdx + 1,
      column: 0,
    });
    expect(wrapperPos.line).toBe(29); // Fetch_Data's `id:` declaration line
  });

  it("leaves generateHandler output byte-identical (node markers add no bytes)", () => {
    const plain = generateHandler(wf);
    const { code } = generateHandlerWithMap(
      wf,
      NODE_DAR_TS,
      "nodeMapFixture.dar.ts",
    );
    expect(code).toBe(plain);
    expect(code).not.toContain("@dar:");
  });
});

// "Which node does this .dar.ts line belong to?" — what a paused debugger asks
// in order to highlight the running node on the visual canvas. Declaration
// lines alone are not enough: most pauses land on a statement inside a step's
// code body, which matches no declaration line.
describe("locateDarTsNodeSourceLines / darTsNodeIdForLine", () => {
  it("claims a node's declaration line AND every line of its code body", () => {
    const lines = locateDarTsNodeSourceLines(NODE_DAR_TS);
    // Fetch_Data: decl line 29, body lines 2-3 (its function's real body).
    expect(lines.get("Fetch_Data")).toEqual([2, 3, 29]);
    // Handle_Item lives in the map body: decl line 15, body line 7.
    expect(lines.get("Handle_Item")).toEqual([7, 15]);
    // A node with no code of its own claims only its declaration line.
    expect(lines.get("Pause")).toEqual([28]);
    expect(lines.get("start")).toEqual([27]);
  });

  it("does NOT mistake a container's `body` reference for the node's own code", () => {
    // `Process_Items` references the child-workflow const `Process_ItemsBody`,
    // which is structure, not code — claiming its lines would make the map
    // node swallow every nested node's lines.
    const lines = locateDarTsNodeSourceLines(NODE_DAR_TS);
    expect(lines.get("Process_Items")).toEqual([31]);
  });

  it("resolves a body statement to its owning node, not just declaration lines", () => {
    // The case that left the canvas with nothing to highlight before this
    // existed: a pause on `const value = 42;` is unambiguously inside
    // Fetch_Data, but matches no node's `id:` line.
    expect(darTsNodeIdForLine(NODE_DAR_TS, 2)).toBe("Fetch_Data");
    expect(darTsNodeIdForLine(NODE_DAR_TS, 3)).toBe("Fetch_Data");
    expect(darTsNodeIdForLine(NODE_DAR_TS, 7)).toBe("Handle_Item");
  });

  it("resolves an operation-entry line to its node", () => {
    expect(darTsNodeIdForLine(NODE_DAR_TS, 28)).toBe("Pause");
    expect(darTsNodeIdForLine(NODE_DAR_TS, 29)).toBe("Fetch_Data");
    expect(darTsNodeIdForLine(NODE_DAR_TS, 15)).toBe("Handle_Item");
  });

  it("returns undefined for a line that belongs to no node", () => {
    // Blank lines, the workflow literal's own scaffolding, `meta`, and
    // anything past the end of the file.
    expect(darTsNodeIdForLine(NODE_DAR_TS, 5)).toBeUndefined(); // blank
    expect(darTsNodeIdForLine(NODE_DAR_TS, 24)).toBeUndefined(); // `nodes: [`
    expect(darTsNodeIdForLine(NODE_DAR_TS, 9999)).toBeUndefined();
  });
});
