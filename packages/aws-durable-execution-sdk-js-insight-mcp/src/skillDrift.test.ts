/**
 * AC-T4 — the mechanical anti-drift guard.
 *
 * The design contract of the skill and the prompts is that they carry ZERO
 * destination-specific schema knowledge: every such fact is owned by core's
 * `buildSystemPrompt` and delegated to at runtime via the `describe_schema`
 * tool. This suite makes that property mechanical rather than aspirational:
 *
 *   1. It builds a list of schema-owned tokens and FIRST proves each really
 *      appears in some destination's `buildSystemPrompt` output — otherwise the
 *      guard would be checking for strings nobody uses and pass vacuously. Any
 *      candidate that appears nowhere is dropped (and reported).
 *   2. It asserts none of the genuinely-present tokens appears in `SKILL.md` or
 *      in any registered prompt's text.
 *   3. It asserts `SKILL.md` DOES instruct calling `describe_schema` — so the
 *      delegation is real, not merely an absence of schema prose.
 *   4. It asserts `SKILL.md` parses: frontmatter present, non-empty `name` and a
 *      `description` specific enough (over a minimum length) that it cannot
 *      degrade to something like "Insight skill".
 *   5. It cross-checks tool names both ways: every tool `SKILL.md` mentions
 *      exists in `TOOL_DESCRIPTIONS`, and all five tools are mentioned.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildSystemPrompt } from "@aws/durable-execution-sdk-js-insight-core";
import { TOOL_DESCRIPTIONS } from "./tools";
import { allPromptText, PROMPTS } from "./prompts";

const SKILL_PATH = path.resolve(__dirname, "skill", "SKILL.md");
const SKILL = readFileSync(SKILL_PATH, "utf8");

/** Every destination `buildSystemPrompt` supports (the queryable + log set). */
const DESTINATIONS = [
  "cloudwatch-logs-exporter",
  "lambda-log-exporter",
  "dynamodb",
  "aurora",
  "redshift",
  "opensearch",
  "s3",
] as const;

/**
 * Candidate schema-owned tokens: distinctive identifiers that only `schema.ts`
 * should own. Each is VERIFIED below to actually appear in some destination's
 * prompt before it is used as a guard token.
 */
const CANDIDATE_TOKENS = [
  "operationsByName",
  "json_extract_scalar",
  "recordType",
  "schemaVersion",
  "executionarn",
  "record_json",
  "@timestamp",
];

/** The `buildSystemPrompt` output for every destination (schema authority). */
const PROMPT_OUTPUTS: string[] = DESTINATIONS.map((d) =>
  buildSystemPrompt(d, {
    tableName: d === "s3" ? "workflow_insight" : undefined,
  }),
);

function tokenAppears(token: string): boolean {
  return PROMPT_OUTPUTS.some((o) => o.includes(token));
}

/** Only tokens genuinely present in some destination's schema output. */
const PRESENT_TOKENS = CANDIDATE_TOKENS.filter(tokenAppears);
const ABSENT_TOKENS = CANDIDATE_TOKENS.filter((t) => !tokenAppears(t));

// Surface exactly which tokens are load-bearing and which were dropped.
console.log(
  `[skillDrift] schema-owned tokens verified present: ${JSON.stringify(
    PRESENT_TOKENS,
  )}; dropped (absent from every buildSystemPrompt output): ${JSON.stringify(
    ABSENT_TOKENS,
  )}`,
);

/** Minimal YAML frontmatter parse: the block between the first two `---`. */
function parseFrontmatter(md: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

describe("skill/prompt anti-drift guard (AC-T4)", () => {
  it("uses only schema-owned tokens that genuinely appear in buildSystemPrompt output", () => {
    // The guard is meaningless if it checks for strings nobody uses.
    expect(PRESENT_TOKENS.length).toBeGreaterThan(0);
    for (const token of PRESENT_TOKENS) {
      expect(tokenAppears(token)).toBe(true);
    }
    // And the reported "dropped" set really is absent everywhere.
    for (const token of ABSENT_TOKENS) {
      expect(tokenAppears(token)).toBe(false);
    }
  });

  it.each(PRESENT_TOKENS)(
    "SKILL.md contains no schema-owned token: %s",
    (token) => {
      expect(SKILL.includes(token)).toBe(false);
    },
  );

  it.each(PRESENT_TOKENS)(
    "no registered prompt text contains schema-owned token: %s",
    (token) => {
      expect(allPromptText().includes(token)).toBe(false);
    },
  );

  it("SKILL.md instructs calling describe_schema (delegation is real)", () => {
    expect(SKILL.includes("describe_schema")).toBe(true);
  });

  it("SKILL.md has valid frontmatter with a non-empty name and a specific description", () => {
    const fm = parseFrontmatter(SKILL);
    expect(fm.name).toBeDefined();
    expect(fm.name.length).toBeGreaterThan(0);
    expect(fm.description).toBeDefined();
    // Specific enough that it cannot degrade to "Insight skill".
    expect(fm.description.length).toBeGreaterThan(80);
  });

  it("every tool named in SKILL.md exists in TOOL_DESCRIPTIONS", () => {
    const toolNames = new Set(TOOL_DESCRIPTIONS.map((t) => t.name));
    // Backticked all-lowercase identifiers in SKILL.md are tool references
    // (uppercase names like MAX_ROWS / DURABLE_INSIGHT_* are excluded by the
    // pattern). Each must be a real tool — a reference to a renamed or removed
    // tool is worse than no skill.
    const referenced = [...SKILL.matchAll(/`([a-z][a-z_]*)`/g)].map(
      (m) => m[1],
    );
    expect(referenced.length).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(toolNames.has(name)).toBe(true);
    }
  });

  it("SKILL.md mentions all five tools", () => {
    for (const { name } of TOOL_DESCRIPTIONS) {
      expect(SKILL.includes(name)).toBe(true);
    }
  });

  it("registers one or two prompts, all with client-valid names", () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(1);
    expect(PROMPTS.length).toBeLessThanOrEqual(2);
    for (const p of PROMPTS) {
      expect(p.name).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });
});
