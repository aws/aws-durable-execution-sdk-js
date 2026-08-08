/**
 * Structural guard: enforces that `runReadOnlyQuery` is the ONE choke point
 * through which every query in this package flows.
 *
 * WHY THIS IS A TEST AND NOT A REVIEW CONVENTION:
 *   A procedural rule ("please route all queries through readOnlyQuery.ts")
 *   that nobody enforces will rot the moment someone adds a second call site.
 *   Core's engine runners (`runAthenaQuery`, `runDynamoDBQuery`, ...) carry NO
 *   read-only enforcement of their own — `assertReadOnly` lives only in
 *   `explorerSession.ts`, which this host does not use — so a stray import of a
 *   runner anywhere else in this package would be an unguarded path to executing
 *   arbitrary, model-supplied SQL, including writes. This test makes "one choke
 *   point" a mechanically checked property of the code rather than a claim in a
 *   commit message.
 *
 * Modeled on `durable-insight-core/src/hostAgnostic.test.ts`: enumerate the
 * real source files and assert a property over each, plus a non-emptiness /
 * known-member check so the enumeration can never pass vacuously.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = __dirname;

/** The single file permitted to import a runner. */
const CHOKE_POINT = "readOnlyQuery.ts";

/**
 * Every core engine runner. Importing ANY of these is executing a query with no
 * read-only enforcement, which is exactly what the choke point exists to
 * prevent. Includes the Phase 4 runners (aurora/redshift/opensearch/logs) too:
 * the guard must forbid them the moment someone wires one up outside the choke
 * point, not only the two supported today.
 */
const RUNNER_NAMES = [
  "runAthenaQuery",
  "runDynamoDBQuery",
  "runAuroraQuery",
  "runRedshiftQuery",
  "runOpenSearchQuery",
  "runLogsInsightsQuery",
] as const;

/** Every non-test `.ts` file under this package's src, recursively. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** True if `src` references any runner name as a whole word. */
function importsAnyRunner(src: string): boolean {
  return RUNNER_NAMES.some((name) => new RegExp(`\\b${name}\\b`).test(src));
}

const sourceFiles = collectSourceFiles(SRC).sort();
const relNames = sourceFiles.map((f) => relative(SRC, f));

describe("query choke point", () => {
  it("enumerates the package sources and includes server.ts", () => {
    // A scan that silently found zero files would make every per-file case
    // below vacuous. Pin non-emptiness AND a known member so the guard cannot
    // pass by finding nothing.
    expect(relNames.length).toBeGreaterThan(0);
    expect(relNames).toContain("server.ts");
    expect(relNames).toContain(CHOKE_POINT);
  });

  it.each(sourceFiles.map((f) => [relative(SRC, f), f] as const))(
    "%s imports a core runner only if it is the choke point",
    (name, file) => {
      const uses = importsAnyRunner(readFileSync(file, "utf-8"));
      if (name === CHOKE_POINT) {
        // The choke point is expected to import runners — that is its job.
        expect(uses).toBe(true);
      } else {
        // Nothing else may. This is the invariant.
        expect(uses).toBe(false);
      }
    },
  );

  it("the choke point actually calls assertReadOnly", () => {
    const chokePointSrc = readFileSync(join(SRC, CHOKE_POINT), "utf-8");
    expect(/\bassertReadOnly\s*\(/.test(chokePointSrc)).toBe(true);
  });
});
