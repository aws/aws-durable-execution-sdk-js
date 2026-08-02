import { existsSync, rmSync } from "node:fs";
import { hasModuleEscape, validateDarJson } from "./agent";
import { parseDarTs, workflowToDarTs } from "./darTs";
import { generateHandler } from "@aws/durable-execution-sdk-js-cdk";

// These fixtures use dag dependency mode, which is gated because the generated
// code calls a runtime the SDK does not implement yet. Opting in keeps the
// coverage while the gate protects real deploys (see dagRuntimeGate.test.ts).
process.env.DAR_ALLOW_DAG_MODE = "1";

const wf = (nodes: unknown[], edges: unknown[] = []) => ({
  darVersion: "1.0",
  name: "t",
  dependencyMode: "dag",
  nodes: [{ id: "s", kind: "start", name: "start" }, ...nodes],
  edges: [{ id: "e1", source: "s", target: "a" }, ...edges],
});

/** Same shape as `wf` but linear, for checks that dag mode short-circuits. */
const linearWf = (nodes: unknown[], edges: unknown[] = []) => ({
  ...wf(nodes, edges),
  dependencyMode: "linear",
});

describe("security hardening", () => {
  // The dry run is not a security boundary (see dryRun's doc comment): a worker
  // shares the process's capabilities and `import()` is syntax, so it cannot be
  // shadowed the way `require` is. What IS guaranteed is that source reaching for
  // a module loader is refused instead of executed.
  it("refuses source that reaches for a module loader", async () => {
    const marker = `/tmp/dar-dryrun-escape-${process.pid}`;
    rmSync(marker, { force: true });
    const { errors } = await validateDarJson(
      JSON.stringify(
        linearWf(
          [
            {
              id: "a",
              kind: "inline",
              name: "evil",
              terminal: true,
              code: `import("node:child_process").then((cp) => cp.execSync("touch ${marker}")); return 1;`,
            },
            { id: "a__end", kind: "end", name: "end" },
          ],
          [{ id: "e2", source: "a", target: "a__end" }],
        ),
      ),
    );
    expect(existsSync(marker)).toBe(false);
    expect(errors.join("\n")).toMatch(/Dry run refused|dynamic import/i);
  }, 20000);

  it("still lets ordinary code through the dry run", async () => {
    const { errors } = await validateDarJson(
      JSON.stringify(
        linearWf(
          [
            {
              id: "a",
              kind: "inline",
              name: "ok",
              terminal: true,
              code: "return 1;",
            },
            { id: "a__end", kind: "end", name: "end" },
          ],
          [{ id: "e2", source: "a", target: "a__end" }],
        ),
      ),
    );
    expect(errors).toEqual([]);
  }, 20000);

  it("rejects errorType values that are not error class names", () => {
    expect(() =>
      generateHandler(
        linearWf(
          [
            { id: "a", kind: "step", name: "A", code: "return 1;" },
            { id: "h", kind: "step", name: "H", code: "return 2;" },
          ],
          [
            {
              id: "b1",
              source: "a",
              target: "h",
              kind: "error",
              errorType: 'Error||(fetch("http://x"),false)',
            },
          ],
        ) as never,
      ),
    ).toThrow(/not a valid error class name/);
  });

  it("neutralizes CR / U+2028 comment breakouts", () => {
    const code = generateHandler(
      wf([
        {
          id: "a",
          kind: "step",
          name: "A",
          code: "return 1;",
          comment: "hi\rmalicious()\u2028more()",
        },
      ]) as never,
    );
    expect(code).toContain("// hi");
    expect(code).toContain("// malicious()");
    expect(code).toContain("// more()");
    expect(code).not.toMatch(/^malicious\(\)/m);
  });

  it("whitelists duration units", () => {
    const code = generateHandler(
      wf([
        {
          id: "a",
          kind: "wait",
          name: "w",
          durationValue: 5,
          durationUnit: "seconds: 0 }); evil(); ({ x",
        },
      ]) as never,
    );
    expect(code).toContain("{ seconds: 5 }");
    expect(code).not.toContain("evil()");
  });

  // Parenthesization alone only held for the `const X: (T) = expr;` form, which
  // requires an initializer; the `let X: (T);` form emitted for nodes with error
  // handling has none, so a crafted type escaped. The type is now parsed and
  // rejected outright — see codegenInjection.test.ts in the cdk package.
  it("rejects a crafted result type instead of emitting it", () => {
    expect(() =>
      generateHandler(
        linearWf([
          {
            id: "a",
            kind: "step",
            name: "A",
            code: "return 1;",
            terminal: true,
            resultType: "any = evil(), x2: any",
          },
        ]) as never,
      ),
    ).toThrow(/not a valid TypeScript type/);
  });

  it("flags invalid resultType at validation time", async () => {
    const { errors } = await validateDarJson(
      JSON.stringify(
        wf(
          [
            {
              id: "a",
              kind: "step",
              name: "A",
              terminal: true,
              code: "return 1;",
              resultType: "any = evil(), x2: any",
            },
            { id: "a__end", kind: "end", name: "end" },
          ],
          [{ id: "e2", source: "a", target: "a__end" }],
        ),
      ),
    );
    expect(errors.join("\n")).toMatch(
      /resultType.*not a valid TypeScript type/,
    );
  }, 20000);

  it("strips NUL marker spoofing from serialized fields", () => {
    const spoofed = {
      darVersion: "1.0",
      name: "t",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "a",
          kind: "step",
          name: "A",
          code: "return 1;",
          // Tries to smuggle a bare-identifier reference via the REF marker.
          payload: "\u0000REF:decide",
        },
      ],
      edges: [{ id: "e1", source: "s", target: "a" }],
    };
    const text = workflowToDarTs(spoofed as never);
    expect(text).not.toContain("payload: decide");
    // Round-trips as an (NUL-stripped) plain string.
    const back = parseDarTs(text);
    expect(back.nodes.find((n) => n.id === "a")!.payload).toBe("REF:decide");
  });
});

/**
 * The dry run is defence-in-depth, not containment (see dryRun's doc comment).
 * These pin the escapes reported in review, all of which bypassed the first
 * version of the check: a bare `Function(...)` with the token split across a
 * concatenation, the `[].constructor.constructor` chain, and
 * `process.mainModule.require`.
 *
 * The source check is load-bearing rather than decorative because `import()` is
 * syntax — it must appear literally to work — and the worker preamble removes the
 * compilers that would otherwise let it be conjured from a string.
 */
describe("dry-run module-escape check", () => {
  it.each([
    ["dynamic import", 'await import("node:child_process")'],
    ["split-token bare Function", 'Function("return imp" + "ort(\'x\')")()'],
    ["new Function", 'new Function("return 1")()'],
    ["constructor chain", '[].constructor.constructor("return 1")()'],
    // async / generator / async-generator functions are SEPARATE intrinsics with
    // their own prototypes, so swapping Function.prototype.constructor alone left
    // each of these as a working compiler.
    ["async fn constructor", '(async function(){}).constructor("return 1")()'],
    ["generator fn constructor", '(function*(){}).constructor("yield 1")()'],
    [
      "async generator constructor",
      '(async function*(){}).constructor("yield 1")()',
    ],
    ["mainModule.require", 'process.mainModule.require("child_process")'],
    // Node 22.3+ returns a builtin directly — no require, no compiler — so it
    // passes every other layer untouched.
    [
      "getBuiltinModule",
      'process.getBuiltinModule("node:child_process").execSync("id")',
    ],
    ["dlopen", 'process.dlopen(module, "/tmp/x.node")'],
    ["createRequire", 'createRequire("/tmp/x")("fs")'],
    ["eval", 'eval("1")'],
    ["import.meta", "import.meta.url"],
  ])("refuses %s", (_label, js) => {
    expect(hasModuleEscape(js)).toBe(true);
  });

  it.each([
    ["a plain return", "return 1;"],
    ["a durable call", "const x = await ctx.step(async () => ({})); return x;"],
    ["`import` as a substring", "const important = 1; return important;"],
    ["a single .constructor", "return obj.constructor.name;"],
  ])("allows %s", (_label, js) => {
    expect(hasModuleEscape(js)).toBe(false);
  });
});
