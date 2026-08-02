/*
 * End-to-end check of NODE-ENTRY breakpoints: a breakpoint set "on a node"
 * (as opposed to on a line of its code body) must resolve to the generated
 * line of that node's OPERATION, for every node kind — including the kinds
 * with no code body of their own, which is the whole point (`ctx.wait`,
 * `ctx.parallel`, …).
 *
 * Unlike `sourceMap.test.ts` in the cdk package, this goes through the REAL
 * deploy path: `bundleWorkflowZip` → esbuild → the chained `index.js.map` →
 * `MapBridge`. That chaining is where a mapping can quietly get lost or shift
 * by a line, so asserting on the pre-bundle map alone would not prove a
 * breakpoint can actually be set.
 */

import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseWorkflow,
  locateDarTsNodeLines,
} from "@aws/durable-execution-sdk-js-cdk";
import { bundleWorkflowZip } from "../deploy";
import { workflowToDarTs } from "../darTs";
import { loadMapBridge, type MapBridge } from "./mapBridge";

// These fixtures use dag dependency mode, which is gated because the generated
// code calls a runtime the SDK does not implement yet. Opting in keeps the
// coverage while the gate protects real deploys (see dagRuntimeGate.test.ts).
process.env.DAR_ALLOW_DAG_MODE = "1";

/** One node of every kind the generator emits an operation for, plus the two
 * container kinds with nodes nested inside them (a map body and a parallel
 * branch) — a nested node's breakpoint has to work the same as a top-level
 * one. `start` is included deliberately as the negative case. */
const DAR_JSON = `{
  "darVersion": "1.0",
  "name": "NodeEntryFixture",
  "dependencyMode": "dag",
  "nodes": [
    { "id": "start", "kind": "start", "name": "Start" },
    { "id": "Pause", "kind": "wait", "name": "Pause", "durationUnit": "seconds", "durationValue": 5 },
    { "id": "Do_Step", "kind": "step", "name": "Do Step", "code": "const value = 42;\\nreturn { value };" },
    { "id": "Call_Child", "kind": "chainInvoke", "name": "Call Child", "functionArn": "arn:aws:lambda:us-east-1:111122223333:function:child:$LATEST", "payloadCode": "return {};" },
    { "id": "Wait_Cb", "kind": "callback", "name": "Wait Cb", "submitterCode": "return;" },
    { "id": "Poll_It", "kind": "waitForCondition", "name": "Poll It", "code": "return { done: true };", "conditionCode": "return state.done;" },
    { "id": "Branch", "kind": "condition", "name": "Branch", "conditionCode": "return true;" },
    { "id": "Map_Items", "kind": "map", "name": "Map Items", "itemsCode": "return [1,2,3];",
      "body": { "darVersion": "1.0", "name": "Map Items Body",
        "nodes": [
          { "id": "m_start", "kind": "start", "name": "M Start" },
          { "id": "Handle_Item", "kind": "step", "name": "Handle Item", "code": "return item * 2;" },
          { "id": "Inner_Wait", "kind": "wait", "name": "Inner Wait", "durationUnit": "seconds", "durationValue": 1 }
        ],
        "edges": [
          { "id": "mi0", "source": "m_start", "target": "Handle_Item" },
          { "id": "mi1", "source": "Handle_Item", "target": "Inner_Wait" }
        ] } },
    { "id": "Fan_Out", "kind": "parallel", "name": "Fan Out",
      "branches": [
        { "name": "b1", "body": { "darVersion": "1.0", "name": "B1",
          "nodes": [
            { "id": "b1_start", "kind": "start", "name": "B1 Start" },
            { "id": "B1_Wait", "kind": "wait", "name": "B1 Wait", "durationUnit": "seconds", "durationValue": 2 }
          ],
          "edges": [{ "id": "b1e", "source": "b1_start", "target": "B1_Wait" }] } }
      ] },
    { "id": "Finish", "kind": "end", "name": "Finish" }
  ],
  "edges": [
    { "id": "e0", "source": "start", "target": "Pause" },
    { "id": "e1", "source": "Pause", "target": "Do_Step" },
    { "id": "e2", "source": "Do_Step", "target": "Call_Child" },
    { "id": "e3", "source": "Call_Child", "target": "Wait_Cb" },
    { "id": "e4", "source": "Wait_Cb", "target": "Poll_It" },
    { "id": "e5", "source": "Poll_It", "target": "Branch" },
    { "id": "e6", "source": "Branch", "target": "Map_Items", "kind": "true" },
    { "id": "e7", "source": "Map_Items", "target": "Fan_Out" },
    { "id": "e8", "source": "Fan_Out", "target": "Finish" }
  ]
}`;

/** The generated bundle text a node breakpoint is expected to land on. */
/**
 * The operation call each node's breakpoint must land on. Matched on the
 * OPERATION and NAME rather than the receiver, because the same node emits
 * `context.wait("X"` in a linear scope, `dag.wait("X"` in a dag scope and
 * `ctx.wait("X"` inside a container body — the receiver is not what this test is
 * about. Pinning it to `context.` made the suite fail as soon as the fixture
 * moved to dag mode, which went unnoticed because no CI job ran it.
 */
const opCall = (op: string, name: string) =>
  new RegExp(`\\.${op}\\("${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);

const EXPECTED_CODE: Record<string, RegExp> = {
  Pause: opCall("wait", "Pause"),
  Do_Step: opCall("step", "Do Step"),
  Call_Child: opCall("invoke", "Call Child"),
  // `dag.callback(...)` in a dag scope, `context.waitForCallback(...)` linear.
  Wait_Cb: /\.(waitForCallback|callback)\("Wait Cb"/,
  Poll_It: opCall("waitForCondition", "Poll It"),
  Map_Items: opCall("map", "Map Items"),
  Fan_Out: opCall("parallel", "Fan Out"),
  Handle_Item: opCall("step", "Handle Item"),
  Inner_Wait: opCall("wait", "Inner Wait"),
  B1_Wait: opCall("wait", "B1 Wait"),
};

jest.setTimeout(120_000);

describe("node-entry breakpoints through the real deploy pipeline", () => {
  let outDir: string;
  let bridge: MapBridge;
  let bundled: string[];
  let nodeLines: Map<string, number>;

  beforeAll(async () => {
    const darJson = JSON.parse(DAR_JSON);
    const darTs = workflowToDarTs(darJson);
    nodeLines = locateDarTsNodeLines(darTs);
    outDir = join(tmpdir(), `node-entry-bp-${Date.now()}`);
    await bundleWorkflowZip(parseWorkflow(darJson), darTs, {
      outDir,
      darSourceFileName: "nodeEntry.dar.ts",
    });
    bridge = await loadMapBridge(join(outDir, "index.js.map"));
    bundled = readFileSync(join(outDir, "index.js"), "utf-8").split("\n");
  });

  afterAll(() => {
    bridge?.dispose();
    rmSync(outDir, { recursive: true, force: true });
  });

  it("locates a declaration line for every node, nested ones included", () => {
    expect([...nodeLines.keys()].sort()).toEqual(
      [
        "B1_Wait",
        "Branch",
        "Call_Child",
        "Do_Step",
        "Fan_Out",
        "Finish",
        "Handle_Item",
        "Inner_Wait",
        "Map_Items",
        "Pause",
        "Poll_It",
        "Wait_Cb",
        "b1_start",
        "m_start",
        "start",
      ].sort(),
    );
  });

  it.each(Object.keys(EXPECTED_CODE))(
    "binds a node breakpoint on %s to that node's own operation line",
    (nodeId) => {
      const darLine = nodeLines.get(nodeId);
      expect(darLine).toBeDefined();
      const bundleLines = bridge.darLineToBundleLines(darLine!);
      expect(bundleLines).toHaveLength(1);
      // The breakpoint lands on THIS node's operation…
      expect(bundled[bundleLines[0] - 1]).toMatch(EXPECTED_CODE[nodeId]);
      // …and a pause there reports THIS node's line back, so the canvas
      // highlights the node the user actually marked.
      expect(bridge.bundleLineToDarLine(bundleLines[0])).toBe(darLine);
    },
  );

  it("binds a `condition` node, which has no code body of its own", () => {
    const darLine = nodeLines.get("Branch")!;
    const bundleLines = bridge.darLineToBundleLines(darLine);
    expect(bundleLines.length).toBeGreaterThan(0);
    expect(bridge.bundleLineToDarLine(bundleLines[0])).toBe(darLine);
  });

  // This fixture is a dag scope, and a dag scope drains when its leaves finish —
  // there is no `end` operation to pause on, so an `end` node binds nothing, the
  // same as a `start` node. (In a linear scope an `end` does emit and does bind.)
  it("refuses to bind an `end` node inside a dag scope", () => {
    expect(bridge.darLineToBundleLines(nodeLines.get("Finish")!)).toEqual([]);
  });

  it("still binds a STEP BODY statement to its own line, not the node entry", () => {
    // Node-entry mapping is additive: statement-level breakpoints inside a
    // step body must keep working, and must NOT collapse onto the wrapper.
    const bodyDarLine = 6; // `const value = 42;` inside Do_Step's function
    const bodyBundleLines = bridge.darLineToBundleLines(bodyDarLine);
    expect(bodyBundleLines).toHaveLength(1);
    expect(bundled[bodyBundleLines[0] - 1]).toContain("const value = 42");
    const entryBundleLine = bridge.darLineToBundleLines(
      nodeLines.get("Do_Step")!,
    )[0];
    expect(bodyBundleLines[0]).not.toBe(entryBundleLine);
  });

  it("refuses to bind `start` nodes — they generate no code at all", () => {
    // The generator walks straight past a start node, so its declaration line
    // produces nothing. Before the bridge did EXACT lookups this silently
    // bound to the next node's operation instead, pausing (and glowing) on the
    // wrong node. The canvas also hides the breakpoint dot for these kinds.
    for (const nodeId of ["start", "m_start", "b1_start"]) {
      expect(bridge.darLineToBundleLines(nodeLines.get(nodeId)!)).toEqual([]);
    }
  });
});
