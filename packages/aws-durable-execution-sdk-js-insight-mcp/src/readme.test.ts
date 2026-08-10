/**
 * AC-5.3: the README is a contract, not free prose. These assertions make it
 * impossible for the README to (a) document a `DURABLE_INSIGHT_*` variable that
 * does not exist, (b) fall out of sync with the set of tools the server
 * actually registers, (c) quote a row cap that differs from the code, or (d)
 * quietly drop the Legal-approved data-disclosure commitment.
 *
 * Everything here is derived from the CODE (imported constants), never from a
 * copy of a value pasted into the test — so the README is checked against the
 * source of truth, and a drift in either direction fails the build.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { TOOL_DESCRIPTIONS } from "./tools";
import { MAX_ROWS } from "./readOnlyQuery";
import { envVarFor, MCP_SETTING_KEYS } from "./envKeys";
import { PROMPTS } from "./prompts";

const README = readFileSync(join(__dirname, "..", "README.md"), "utf8");

/** The exact set of `DURABLE_INSIGHT_*` variables this host accepts. */
const ACCEPTED_ENV_VARS = new Set(MCP_SETTING_KEYS.map((k) => envVarFor(k)));

/** Every `DURABLE_INSIGHT_*` token the README actually contains, de-duplicated. */
function envVarTokensInReadme(): string[] {
  const matches = README.match(/DURABLE_INSIGHT_[A-Z0-9_]+/g) ?? [];
  return [...new Set(matches)];
}

describe("README variable existence", () => {
  it("1. every DURABLE_INSIGHT_* token in the README is a real accepted variable", () => {
    const tokens = envVarTokensInReadme();
    // Sanity: the README does document some variables (guards against a regex
    // that silently matches nothing making this test vacuously pass).
    expect(tokens.length).toBeGreaterThan(0);

    const unknown = tokens.filter((t) => !ACCEPTED_ENV_VARS.has(t));
    // A non-empty array here names the offending (typo'd or renamed) variable,
    // which is exactly the support burden this assertion prevents.
    expect(unknown).toEqual([]);
  });
});

describe("README tool coverage", () => {
  const toolNames = TOOL_DESCRIPTIONS.map((t) => t.name);

  it("2a. every registered tool name is mentioned in the README", () => {
    const missing = toolNames.filter((name) => !README.includes(name));
    expect(missing).toEqual([]);
  });

  it("2b. every tool-looking name the README claims exists is a real tool or prompt", () => {
    // Tokens the README presents in backticks that look like an identifier
    // (lower snake_case with at least one underscore) must be a real tool name,
    // a real prompt name, or an explicitly allowed non-tool identifier — never
    // an invented tool.
    const allowed = new Set<string>([
      ...toolNames,
      ...PROMPTS.map((p) => p.name),
      "workflow_insight", // the default table name for the SQL destinations
    ]);
    const backticked = README.match(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g) ?? [];
    const identifiers = backticked.map((m) => m.replace(/`/g, ""));
    const offending = identifiers.filter((id) => !allowed.has(id));
    expect([...new Set(offending)]).toEqual([]);
  });
});

describe("README row cap", () => {
  it("3. the README quotes the MAX_ROWS value the code defines", () => {
    expect(README).toContain(String(MAX_ROWS));
  });
});

describe("README data disclosure", () => {
  it("4. the disclosure section exists and states payloads are returned verbatim", () => {
    // Section exists.
    expect(README.toLowerCase()).toContain("disclosure");
    // The Legal-committed fact: input/output payloads are returned verbatim.
    // "verbatim" is used ONLY in that sentence, so deleting it fails here.
    expect(README).toContain("verbatim");
    expect(README).toContain("`input`");
    expect(README).toContain("`output`");
  });
});
