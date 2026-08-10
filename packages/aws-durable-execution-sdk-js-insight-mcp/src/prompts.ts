/**
 * MCP prompts surfaced by this server (via `registerPrompt`, the non-deprecated
 * API). A client such as Kiro lists these under `/prompts` and `@name`, so they
 * ship *inside* the server and need no separate install by the customer.
 *
 * ZERO destination-specific schema knowledge lives here — on purpose. Every
 * fact about a destination's record fields, column casing, table quoting, and
 * dialect idioms is owned by core's `buildSystemPrompt` and returned, for
 * whatever destination is actually configured, by the `describe_schema` tool.
 * A prompt therefore encodes only the *order of operations* an agent should
 * follow — knowledge it will not otherwise infer — and defers all schema facts
 * to `describe_schema` at runtime. `skillDrift.test.ts` enforces this
 * mechanically: no schema-owned token may appear in any prompt's text.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MAX_ROWS } from "./readOnlyQuery";

/**
 * A prompt this server registers. `render` produces the message body from the
 * (all-string, all-optional) arguments a client supplies; `skillDrift.test.ts`
 * scans `title`, `description`, and `render({})` for schema-owned tokens.
 */
export interface PromptSpec {
  name: string;
  title: string;
  description: string;
  /** MCP prompt arguments are always strings; keep the shape simple. */
  argsSchema: Record<string, z.ZodType<string | undefined>>;
  render: (args: Record<string, string | undefined>) => string;
}

/** Shared preamble: the ordering every investigation should follow. */
function orderingSteps(): string[] {
  return [
    "1. Call `test_destination` first to confirm the configured destination is " +
      "reachable and fully configured. If it reports missing environment " +
      "variables, stop and report them — do not guess.",
    "2. Call `describe_schema` next, and read it, BEFORE writing any query. The " +
      "record fields and query idioms differ per destination, and only the " +
      "running server knows which destination is configured — so ask it rather " +
      "than assuming.",
    "3. Narrow the set with `list_executions` (filter by status, function name, " +
      "or a time window). Prefer this over hand-written SQL: it cannot be got " +
      "wrong and costs fewer tokens.",
    "4. Drill into specific records with `get_execution` by their execution ARN " +
      "to inspect step-level detail.",
    "5. Fall back to `query` only when the structured tools cannot express the " +
      "question — and only after `describe_schema`, so the query uses the right " +
      "field names and syntax for the configured destination.",
  ];
}

/** Closing note shared by both prompts. */
function closingNote(): string {
  return (
    "All access is READ-ONLY (writes are refused before any AWS call), and " +
    `results are capped at ${MAX_ROWS} rows. For CloudWatch Logs destinations, ` +
    "set a lookback window — those queries require an explicit time range."
  );
}

function renderInvestigate(args: Record<string, string | undefined>): string {
  const focus: string[] = [];
  if (args.functionName) {
    focus.push(`Focus on the Lambda function "${args.functionName}".`);
  }
  if (args.lookbackHours) {
    focus.push(
      `Limit the investigation to roughly the last ${args.lookbackHours} ` +
        "hours (pass this as the lookback window on log destinations, or as a " +
        "since/until bound on list_executions).",
    );
  }
  return [
    "You are investigating failures in AWS Lambda durable function executions " +
      "using the durable-insight MCP server. Work through the tools in this " +
      "order — the ordering matters more than any single query:",
    "",
    ...orderingSteps(),
    "",
    "When narrowing in step 3, prefer filtering to FAILED executions first, " +
      "then widen if you find nothing.",
    ...(focus.length > 0 ? ["", ...focus] : []),
    "",
    closingNote(),
  ].join("\n");
}

function renderExplore(args: Record<string, string | undefined>): string {
  const filter = args.status
    ? `Filter to executions with status "${args.status}".`
    : "List across all statuses unless the user asks to narrow.";
  return [
    "You are getting an overview of recent AWS Lambda durable function " +
      "executions using the durable-insight MCP server. Follow this order:",
    "",
    "1. Call `test_destination` to confirm the destination is configured and " +
      "reachable.",
    "2. Call `describe_schema` to learn the configured destination's fields and " +
      "query idioms before running anything.",
    "3. Use `list_executions` to page through recent executions. " + filter,
    "4. Use `get_execution` to inspect any single execution by its execution " +
      "ARN, and `query` only for questions the structured tools cannot express " +
      "(after `describe_schema`).",
    "",
    closingNote(),
  ].join("\n");
}

/** The single source of truth for every prompt this server registers. */
export const PROMPTS: readonly PromptSpec[] = [
  {
    name: "investigate_workflow_failure",
    title: "Investigate a durable function failure",
    description:
      "Guided, correct-order investigation of AWS Lambda durable function " +
      "execution failures: verify the destination, learn its schema via " +
      "describe_schema, narrow with list_executions, then drill into records " +
      "with get_execution, using query only as a last resort. Accepts an " +
      "optional functionName and lookbackHours to scope the search.",
    argsSchema: {
      functionName: z
        .string()
        .optional()
        .describe(
          "Optional Lambda function name to focus the investigation on.",
        ),
      lookbackHours: z
        .string()
        .optional()
        .describe(
          'Optional lookback window in hours to scope the search (e.g. "24").',
        ),
    },
    render: renderInvestigate,
  },
  {
    name: "explore_recent_executions",
    title: "Explore recent durable function executions",
    description:
      "Guided overview of recent AWS Lambda durable function executions: " +
      "verify the destination, learn its schema via describe_schema, then use " +
      "list_executions to survey activity, preferring the structured tools over " +
      "hand-written SQL. Accepts an optional status filter.",
    argsSchema: {
      status: z
        .string()
        .optional()
        .describe("Optional status filter: RUNNING, SUCCEEDED, or FAILED."),
    },
    render: renderExplore,
  },
];

/**
 * Register every prompt in {@link PROMPTS} on the server via `registerPrompt`.
 * The handler wraps `render` output in a single user message — the shape
 * `prompts/get` returns to a client.
 */
export function registerPrompts(server: McpServer): void {
  for (const prompt of PROMPTS) {
    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
        argsSchema: prompt.argsSchema,
      },
      (args: Record<string, string | undefined>) => ({
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: prompt.render(args) },
          },
        ],
      }),
    );
  }
}

/**
 * All text every prompt contributes to a client's surface — name, title,
 * description, and the rendered message body with no arguments. Used by
 * `skillDrift.test.ts` to assert no schema-owned token leaks into a prompt.
 */
export function allPromptText(): string {
  return PROMPTS.map((p) =>
    [p.name, p.title, p.description, p.render({})].join("\n"),
  ).join("\n\n");
}
