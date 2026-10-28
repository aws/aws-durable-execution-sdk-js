/**
 * AC-3.3: every registered tool's description must be non-empty and under the
 * 10,000-character cap (descriptions over ~10k measurably degrade agent
 * tool-selection). This is the guard that keeps the large `buildSystemPrompt`
 * guidance in `describe_schema`'s RESULT rather than any tool description —
 * embedding the guidance in a description makes this suite fail.
 *
 * `TOOL_DESCRIPTIONS` is the single source of truth the server registers from,
 * so asserting over it covers exactly the descriptions that ship.
 */
import { SERVER_INSTRUCTIONS, TOOL_DESCRIPTIONS } from "./tools";

const DESCRIPTION_CAP = 10_000;

describe("server instructions", () => {
  it("route bare execution requests here, and stay short", () => {
    // Clients that defer tool schemas show the agent these instructions and
    // little else, so they must name the tools and the viewer links. They are
    // sent on every turn, so they must also stay small.
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(1_000);
    expect(SERVER_INSTRUCTIONS).toContain("list_executions");
    expect(SERVER_INSTRUCTIONS).toContain("viewerUrl");
    // Every tool the instructions name must be a real one.
    const named = SERVER_INSTRUCTIONS.match(/`([a-z_]+)`/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    const tools = new Set(TOOL_DESCRIPTIONS.map((t) => t.name));
    for (const token of named) {
      const name = token.replace(/`/g, "");
      if (name.includes("_")) expect(tools.has(name)).toBe(true);
    }
  });
});

describe("tool descriptions", () => {
  it("registers exactly the five expected tools", () => {
    expect(TOOL_DESCRIPTIONS.map((t) => t.name).sort()).toEqual(
      [
        "describe_schema",
        "get_execution",
        "list_executions",
        "query",
        "test_destination",
      ].sort(),
    );
  });

  it.each(TOOL_DESCRIPTIONS)(
    "$name has a non-empty description under the cap",
    ({ description }) => {
      expect(description.length).toBeGreaterThan(0);
      expect(description.length).toBeLessThan(DESCRIPTION_CAP);
    },
  );
});
