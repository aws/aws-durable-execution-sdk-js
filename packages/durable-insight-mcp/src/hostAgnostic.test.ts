/**
 * Guards that the MCP server package imports only ITS OWN host API.
 *
 * This host is plain Node. It speaks the MCP protocol, so `@modelcontextprotocol/sdk`
 * is legitimate here — but it has neither the VS Code extension API nor Electron, so
 * importing either would break it at runtime. Like the desktop guard, this is "this
 * host and no other" rather than "host-free", which is why the permitted module is
 * named explicitly instead of banning the whole list.
 *
 * WHY THIS FILE EXISTS AT ALL:
 * Review found that a host-specific import in shared code was invisible to every
 * mechanism — eslint, typecheck, bundles and tests all passed with an Electron import
 * sitting in a core module that no test happened to cover. Core and the desktop
 * package each gained a guard; this package is the third host and needs the same one,
 * or it inherits exactly the gap that was just closed elsewhere.
 *
 * The detector comes from `@aws/durable-insight-core`, where it is self-tested against
 * every module in every import form including subpaths. It is deliberately not
 * re-implemented: two divergent copies of a correctness-critical regex is the
 * duplication this whole stack exists to remove.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { HOST_MODULES, findHostModules } from "@aws/durable-insight-core";

const SRC = __dirname;

/** The only host API this package may import. */
const PERMITTED = HOST_MODULES.mcpSdk;

/** The other hosts' APIs, which do not exist in this process. */
const FORBIDDEN = [HOST_MODULES.vscode, HOST_MODULES.electron];

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

const names = collectSourceFiles(SRC)
  .map((f) => relative(SRC, f))
  .sort();

describe("MCP host imports only its own host API", () => {
  // Guards against the guard passing by finding nothing.
  it("finds its own sources, including known members", () => {
    expect(names.length).toBeGreaterThan(3);
    for (const expected of ["server.ts", "tools.ts", "readOnlyQuery.ts"]) {
      expect(names).toContain(expected);
    }
  });

  it.each(names)("%s imports no other host's API", (name) => {
    const found = findHostModules(
      readFileSync(join(SRC, name), "utf-8"),
      FORBIDDEN,
    );
    expect(found).toEqual([]);
  });

  it("does import the MCP SDK somewhere, so the check above is not vacuous", () => {
    const usesSdk = names.some(
      (n) =>
        findHostModules(readFileSync(join(SRC, n), "utf-8"), [PERMITTED])
          .length > 0,
    );
    expect(usesSdk).toBe(true);
  });
});
