/**
 * The query examples in the Logs Insights system prompts must be queries the
 * service accepts, because the agent copies their shape.
 */
import { buildSystemPrompt } from "./schema";

/** The example queries: each prompt line that starts with "A: ". */
function exampleQueries(prompt: string): string[] {
  return prompt
    .split("\n")
    .filter((l) => l.startsWith("A: "))
    .map((l) => l.slice(3));
}

describe("lambda-log-exporter prompt examples", () => {
  // Logs Insights rejects `fields <name>` after `parse ... as <name>` with
  // MalformedQueryException "Ephemeral field is already defined" (#1143).
  // Measured with StartQuery on a real log group: the same query with
  // `display` in place of `fields` is accepted.
  it("list no parsed field with `fields`", () => {
    const queries = exampleQueries(buildSystemPrompt("lambda-log-exporter"));
    expect(queries.filter((q) => q.includes("parse ")).length).toBeGreaterThan(
      2,
    );
    for (const q of queries) {
      const stages = q.split(" | ").map((s) => s.trim());
      const parsed = stages.flatMap((s) =>
        s.startsWith("parse ")
          ? s
              .slice(s.lastIndexOf(" as ") + 4)
              .split(/,\s*/)
              .map((a) => a.trim())
          : [],
      );
      for (const stage of stages.filter((s) => s.startsWith("fields "))) {
        const listed = stage.slice("fields ".length).split(/,\s*/);
        expect({ q, clash: listed.filter((f) => parsed.includes(f)) }).toEqual({
          q,
          clash: [],
        });
      }
    }
  });
});
