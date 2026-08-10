/**
 * Structural guard: enforces that `runReadOnlyQuery` is the one place this package
 * executes a query.
 *
 * WHY THIS IS A TEST AND NOT A REVIEW CONVENTION:
 * A procedural rule ("route all queries through readOnlyQuery.ts") rots the moment
 * someone adds a second call site. `assertReadOnly` lives in this package, not in
 * core's runners -- core's own guard is inside `explorerSession.ts`, which this host
 * deliberately bypasses -- so any other path from here into core's query surface is
 * an unguarded route to executing model-supplied SQL, writes included.
 *
 * WHAT AN EARLIER VERSION GOT WRONG, TWICE:
 *
 *   1. It forbade only the six `run*Query` runners. Core exports SEVEN more
 *      functions that execute a query, most of them by calling a runner
 *      internally: `fetchAthenaRecord`, `fetchDynamoDBRecord`, `fetchAuroraRecord`,
 *      `fetchRedshiftRecord`, `tableExists`, and `ensureAthenaTable` (which runs
 *      DDL). A file importing `fetchAthenaRecord` executes SQL while mentioning no
 *      runner at all, so the guard stayed green over exactly the hole it claims to
 *      close. Enumerating by capability rather than by name prefix is the fix.
 *
 *   2. It matched names as whole words anywhere in the file, including comments.
 *      `sqlSafe.ts` and `tools.ts` both DISCUSS `fetchAthenaRecord` in their doc
 *      comments -- correctly, since they explain how core escapes values -- so a
 *      text scan flags the documentation and forces the explanation to be deleted
 *      to make the guard pass. This version reads import declarations from the
 *      TypeScript AST, so a name is only "used" if it is actually imported.
 *
 * The same two mistakes, in the same shapes, as the host-module scan in core:
 * an invariant named too narrowly, and a scanner that flagged its own prose.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

const SRC = __dirname;
const CORE_SRC = join(SRC, "..", "..", "durable-insight-core", "src");
const CORE_MODULE = "@aws/durable-insight-core";

/** The single file permitted to import core's query surface. */
const CHOKE_POINT = "readOnlyQuery.ts";

/**
 * Core exports that execute a query, and which therefore carry NO read-only
 * enforcement of their own.
 *
 * Kept complete by `core's query surface is fully enumerated` below, which derives
 * the same set from core's AST and fails if this list falls behind.
 */
const QUERY_EXECUTING_EXPORTS = [
  // The six engine runners.
  "runAthenaQuery",
  "runDynamoDBQuery",
  "runAuroraQuery",
  "runRedshiftQuery",
  "runOpenSearchQuery",
  "runLogsInsightsQuery",
  // Single-record fetches that build and execute their own SQL.
  "fetchAthenaRecord",
  "fetchDynamoDBRecord",
  "fetchAuroraRecord",
  "fetchRedshiftRecord",
  // Metadata and DDL.
  "tableExists",
  "ensureAthenaTable",
] as const;

/**
 * Deliberate exceptions, each with a reason it is safe.
 *
 * These execute a query outside the choke point ON PURPOSE. Listing them here is
 * what makes them decisions rather than oversights: adding to this list requires
 * writing down why, and the test below asserts each entry is genuinely used, so a
 * stale exception cannot sit here widening the hole after its caller is gone.
 */
const PERMITTED_OUTSIDE_CHOKE_POINT: Record<
  string,
  { file: string; reason: string }
> = {
  fetchLogsInsightsRecord: {
    file: "tools.ts",
    reason:
      "get_execution on a log destination. The Logs Insights query language has no " +
      "write forms, so there is nothing for assertReadOnly to catch -- the same " +
      "reason the choke point omits it on that path.",
  },
  testDestination: {
    file: "server.ts",
    reason:
      "the test_destination tool. Core's own connectivity probe; it issues fixed " +
      "read-only statements that no caller can influence.",
  },
};

/** Every non-test `.ts` file under this package's src, recursively. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSourceFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Names a file imports from core. Reads import declarations only, so a name
 * appearing in a comment or a string is not a use.
 */
function importedFromCore(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf-8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const names: string[] = [];
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== CORE_MODULE
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        // `propertyName` is the original name in `import { a as b }`.
        names.push((element.propertyName ?? element.name).text);
      }
    }
  }
  return names;
}

/**
 * Derive core's query-executing exports from its AST: an exported function whose
 * body either calls one of the engine runners or sends an AWS SDK command.
 */
function deriveCoreQuerySurface(): string[] {
  const RUNNERS = new Set([
    "runAthenaQuery",
    "runDynamoDBQuery",
    "runAuroraQuery",
    "runRedshiftQuery",
    "runOpenSearchQuery",
    "runLogsInsightsQuery",
  ]);
  const found: string[] = [];

  for (const entry of readdirSync(CORE_SRC)) {
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
    const file = join(CORE_SRC, entry);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf-8"),
      ts.ScriptTarget.Latest,
      true,
    );

    for (const statement of source.statements) {
      if (
        !ts.isFunctionDeclaration(statement) ||
        !statement.name ||
        !statement.modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.ExportKeyword,
        ) ||
        !statement.body
      ) {
        continue;
      }
      const name = statement.name.text;
      if (RUNNERS.has(name)) {
        found.push(name);
        continue;
      }

      let executes = false;
      const walk = (node: ts.Node): void => {
        if (executes) return;
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          // `runXQuery(...)`
          if (ts.isIdentifier(callee) && RUNNERS.has(callee.text)) {
            executes = true;
          }
          // `client.send(...)` -- a direct AWS call.
          if (
            ts.isPropertyAccessExpression(callee) &&
            callee.name.text === "send"
          ) {
            executes = true;
          }
        }
        ts.forEachChild(node, walk);
      };
      walk(statement.body);
      if (executes) found.push(name);
    }
  }
  return [...new Set(found)].sort();
}

const sourceFiles = collectSourceFiles(SRC).sort();
const relNames = sourceFiles.map((f) => relative(SRC, f));

describe("query choke point", () => {
  it("enumerates the package sources and includes known members", () => {
    // A scan that found nothing would make every per-file case below vacuous.
    expect(relNames.length).toBeGreaterThan(0);
    expect(relNames).toContain("server.ts");
    expect(relNames).toContain(CHOKE_POINT);
  });

  it("reads imports rather than text, so prose about core is not a use", () => {
    // Aimed at the parser: these files DISCUSS core's record fetches in their doc
    // comments. If this ever fails, the scan has regressed to matching text and
    // will start demanding that documentation be deleted.
    for (const file of ["sqlSafe.ts", "tools.ts"]) {
      const src = readFileSync(join(SRC, file), "utf-8");
      expect(src).toContain("fetchAthenaRecord");
      expect(importedFromCore(join(SRC, file))).not.toContain(
        "fetchAthenaRecord",
      );
    }
  });

  it.each(sourceFiles.map((f) => [relative(SRC, f), f] as const))(
    "%s imports core's query surface only if permitted",
    (name, file) => {
      const imported = importedFromCore(file);
      const offenders = imported.filter(
        (n) =>
          (QUERY_EXECUTING_EXPORTS as readonly string[]).includes(n) &&
          name !== CHOKE_POINT,
      );
      expect(offenders).toEqual([]);

      // A permitted exception may only appear in the file it was granted for.
      for (const n of imported) {
        const exception = PERMITTED_OUTSIDE_CHOKE_POINT[n];
        if (exception) expect(name).toBe(exception.file);
      }
    },
  );

  it("the choke point imports runners and calls assertReadOnly", () => {
    const imported = importedFromCore(join(SRC, CHOKE_POINT));
    // Its job, so absence means the choke point stopped being one.
    expect(imported).toContain("runAthenaQuery");
    const src = readFileSync(join(SRC, CHOKE_POINT), "utf-8");
    expect(/\bassertReadOnly\s*\(/.test(src)).toBe(true);
  });

  it("every permitted exception is actually used, and where it says", () => {
    // Stops a stale exception from sitting here widening the rule after the
    // caller it was written for is gone.
    for (const [name, { file }] of Object.entries(
      PERMITTED_OUTSIDE_CHOKE_POINT,
    )) {
      expect(importedFromCore(join(SRC, file))).toContain(name);
    }
  });

  it("core's query surface is fully enumerated", () => {
    // THE META-GUARD. Derives the set from core's AST, so a new core export that
    // executes a query fails here instead of quietly falling outside the rule --
    // which is how `fetchAthenaRecord` and friends escaped the first version.
    const derived = deriveCoreQuerySurface();
    // Non-vacuity: an empty derivation would make the assertion below trivial.
    expect(derived.length).toBeGreaterThan(6);
    expect(derived).toContain("runAthenaQuery");

    const known = new Set<string>([
      ...QUERY_EXECUTING_EXPORTS,
      ...Object.keys(PERMITTED_OUTSIDE_CHOKE_POINT),
      // Reaches a remote service but not a query engine: no SQL, so nothing for
      // `assertReadOnly` to inspect.
      //
      // The derivation above treats ANY `.send(` as executing something, which
      // over-matches on purpose: `verifyResult` calls `model.send(...)` on an LLM
      // judge, and `sendConverse` talks to Bedrock. Narrowing the heuristic to
      // `client.send(new SomeCommand(...))` would drop these, but it would also
      // drop a future runner that dispatches differently. A false positive costs
      // one line here; a false negative is an unguarded query path, which is the
      // whole thing this file exists to prevent.
      "sendConverse",
      "listBedrockModels",
      "listenToQueue",
      "verifyResult",
    ]);
    const unclassified = derived.filter((n) => !known.has(n));
    expect(unclassified).toEqual([]);
  });
});
