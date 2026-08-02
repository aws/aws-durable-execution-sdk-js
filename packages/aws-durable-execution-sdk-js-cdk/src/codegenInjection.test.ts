import * as ts from "typescript";
import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

/**
 * `inputType`, `resultType`, `clientClass` and `command` are interpolated into
 * generated code, and all four render as short labels in the Studio inspector —
 * so a payload hidden in one is invisible to someone reviewing the canvas. That
 * is the same reasoning behind the pre-existing `errorType` identifier check.
 *
 * Step and inline `code` are raw by design and deliberately out of scope here.
 */
function wf(extra: Partial<DarWorkflow>, node: Record<string, unknown> = {}) {
  return {
    darVersion: "1",
    name: "w",
    ...extra,
    nodes: [
      { id: "s", kind: "start", name: "start" },
      {
        id: "n",
        kind: "step",
        name: "A",
        code: "return 1;",
        terminal: true,
        ...node,
      },
    ],
    edges: [{ id: "e", source: "s", target: "n" }],
  } as unknown as DarWorkflow;
}

/** A node with an error route, which emits the `let X: (T);` declaration form. */
function letFormWf(resultType: string): DarWorkflow {
  return {
    darVersion: "1",
    name: "w",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      { id: "n", kind: "step", name: "A", code: "return 1;", resultType },
      { id: "r", kind: "step", name: "R", code: "return 2;", terminal: true },
    ],
    edges: [
      { id: "e", source: "s", target: "n" },
      { id: "e2", source: "n", target: "r", kind: "error" },
    ],
  } as unknown as DarWorkflow;
}

function sdkWf(clientClass: string, command = "GetObjectCommand"): DarWorkflow {
  return wf(
    {},
    {
      kind: "awsSdkCall",
      clientPackage: "@aws-sdk/client-s3",
      clientClass,
      command,
      input: "{}",
    },
  );
}

/** Statement count, to prove nothing escaped into the top level. */
function topLevelStatements(code: string): number {
  return ts.createSourceFile("h.ts", code, ts.ScriptTarget.ES2022, true)
    .statements.length;
}

describe("inputType", () => {
  const ESCAPE =
    'unknown;\nconst STOLEN = require("child_process").execSync("id");\ntype _I = unknown';

  it("rejects a type that closes the alias and appends statements", () => {
    expect(() => generateHandler(wf({ inputType: ESCAPE }))).toThrow(
      /not a valid TypeScript type/,
    );
  });

  it("accepts ordinary type expressions", () => {
    const code = generateHandler(wf({ inputType: "{ orderId: string }" }));
    expect(code).toContain("type WorkflowInput = { orderId: string };");
  });

  it("leaves no injected top-level statement when omitted", () => {
    const code = generateHandler(wf({}));
    expect(code).toContain("type WorkflowInput = unknown;");
    // import + type alias + the exported handler.
    expect(topLevelStatements(code)).toBe(3);
  });
});

describe("resultType", () => {
  const LET_ESCAPE =
    'number); (globalThis).LEAKED = require("child_process"); (0 as never';

  it("rejects an escape on the `let` path, which has no initializer", () => {
    expect(() => generateHandler(letFormWf(LET_ESCAPE))).toThrow(
      /result type is not a valid TypeScript type/,
    );
  });

  it("rejects an escape on the `const` path too", () => {
    expect(() =>
      generateHandler(
        wf({}, { resultType: "number); (globalThis).L = 1; (0 as never" }),
      ),
    ).toThrow(/result type is not a valid TypeScript type/);
  });

  it("accepts ordinary result types on both paths", () => {
    expect(generateHandler(letFormWf("{ total: number }"))).toContain(
      "let A: ({ total: number })",
    );
    expect(
      generateHandler(wf({}, { resultType: "{ total: number }" })),
    ).toContain(": ({ total: number })");
  });
});

describe("awsSdkCall clientClass and command", () => {
  it("rejects a clientClass that escapes the call and the import list", () => {
    expect(() =>
      generateHandler(sdkWf("S3Client(); (globalThis).X = 1; new S3Client")),
    ).toThrow(/client class .* is not a valid identifier/);
  });

  it("rejects a command that escapes", () => {
    expect(() =>
      generateHandler(sdkWf("S3Client", "GetObjectCommand; evil()")),
    ).toThrow(/command .* is not a valid identifier/);
  });

  it("accepts real client/command names", () => {
    const code = generateHandler(sdkWf("S3Client"));
    expect(code).toContain("new S3Client({})");
    expect(code).toContain(
      'import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";',
    );
  });
});
