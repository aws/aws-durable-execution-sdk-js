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
import { TOOL_DESCRIPTIONS } from "./tools";

const DESCRIPTION_CAP = 10_000;

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
