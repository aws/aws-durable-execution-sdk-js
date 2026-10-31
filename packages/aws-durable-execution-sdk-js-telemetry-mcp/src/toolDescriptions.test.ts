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
  it("name only real tools, and stay short", () => {
    // Clients put the instructions in the agent's prompt on every turn.
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(1_000);
    const tools = new Set(TOOL_DESCRIPTIONS.map((t) => t.name));
    const named = (SERVER_INSTRUCTIONS.match(/`[a-z_]+`/g) ?? [])
      .map((t) => t.slice(1, -1))
      .filter((t) => t.includes("_") || t === "query");
    expect(named).toEqual(
      expect.arrayContaining(["list_executions", "get_execution", "query"]),
    );
    for (const name of named) expect(tools.has(name)).toBe(true);
    expect(SERVER_INSTRUCTIONS).toContain("viewerLink");
  });

  it("claim durable executions only, not every request about executions", () => {
    // An agent may also have a Step Functions or CI server. A bare
    // "executions" request is for the agent and the user to route.
    expect(SERVER_INSTRUCTIONS).toContain(
      "durable executions or durable function runs",
    );
    expect(SERVER_INSTRUCTIONS).not.toMatch(/workflow executions|unqualified/i);
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
