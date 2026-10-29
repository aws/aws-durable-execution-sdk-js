/**
 * Registers this server's tools on an McpServer.
 *
 * Kept apart from server.ts, whose import starts the stdio server, so tests
 * can register the tools on an in-memory server and call them.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  checkAthenaResultLocation,
  resolveCredentials,
  testDestination,
  type TelemetryConfig,
} from "@aws/durable-execution-sdk-js-telemetry-core";
import { z } from "zod";
import { missingRequiredEnvVars } from "./config";
import { MAX_ROWS, runReadOnlyQuery } from "./readOnlyQuery";
import {
  buildDescribeSchemaResult,
  DESCRIBE_SCHEMA_DESCRIPTION,
  GET_EXECUTION_DESCRIPTION,
  LIST_EXECUTIONS_DESCRIPTION,
  QUERY_DESCRIPTION,
  runGetExecution,
  runListExecutions,
  TEST_DESTINATION_DESCRIPTION,
  DEFAULT_RECORD_LOOKBACK_HOURS,
} from "./tools";
import { askUserToAccept, createWriteAccessGate } from "./writeAccessGate";
import { type ConsentStore, consentKey } from "./consentStore";
import {
  type ExecutionViewer,
  VIEWER_LINK_FIELD,
  executionArnFromRecord,
  executionNameFromRecord,
  markdownLink,
  withViewerLinks,
} from "./executionViewer";

/** Wrap a JSON-serializable payload in the MCP text-content result shape. */
function jsonResult(payload: unknown, isError = false) {
  const result = {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
  };
  return isError ? { ...result, isError: true } : result;
}

/**
 * The tools that make AWS calls (`query`, `get_execution`, `list_executions`)
 * must never touch the network with incomplete config. Returns a
 * SUCCESSFUL-tool-call result naming the missing DURABLE_TELEMETRY_* variables
 * when any are unset, or `null` when config is complete and the tool may
 * proceed. A missing-config finding is not a tool error — the tool did exactly
 * what it was asked to.
 */
function missingConfigResult(config: TelemetryConfig) {
  const missingEnvVars = missingRequiredEnvVars(config);
  if (missingEnvVars.length === 0) return null;
  return jsonResult({
    ok: false,
    summary:
      `Destination configuration is incomplete: ${missingEnvVars.length} ` +
      `required environment variable(s) unset. Set them and try again.`,
    destinationType: config.destinationType,
    missingEnvVars,
  });
}

/**
 * Registers the tools. The `config` and `acceptedByEnv` are captured from
 * startup (read once) so the tools never re-read the environment.
 *
 * With a `viewer`, results gain a `viewerLink` per execution (a Markdown link
 * titled with the execution name): a column on `query` and `list_executions`
 * rows, a field on `get_execution`. Without one
 * (disabled, or in tests) results are exactly as before.
 */
export function registerTools(
  server: McpServer,
  config: TelemetryConfig,
  acceptedByEnv: boolean,
  viewer?: ExecutionViewer,
  consentStore?: ConsentStore,
): void {
  const key = consentKey(config);
  // The three data tools call this before any query; see writeAccessGate.ts.
  const writeAccessGate = createWriteAccessGate({
    acceptedByEnv,
    ask: (message) => askUserToAccept(server.server, message),
    // stdout is the MCP transport, so diagnostics go to stderr.
    log: (message) => process.stderr.write(`[durable-telemetry] ${message}\n`),
    remembered: consentStore && {
      has: () => consentStore.has(key),
      add: () => consentStore.add(key),
    },
    // On S3 + Athena, results written inside the table's data add rows on
    // every query, whatever the credentials. So the prompt names that too,
    // and says so when the location could not be determined.
    configurationWarning: async () => {
      if (config.destinationType !== "s3") return undefined;
      const location = await checkAthenaResultLocation(
        config,
        resolveCredentials(config.awsProfile),
      );
      if (location.kind === "inside") return location.finding;
      if (location.kind === "undetermined") {
        return (
          "The server could not check whether Athena writes query results " +
          `inside the table's data: ${location.reason}`
        );
      }
      return undefined;
    },
  });
  // Returns a tool result when the call must not query, or null when it may.
  // The gate can wait a long time for the user's answer, and several calls can
  // share one prompt. A call the client cancelled meanwhile must not start its
  // query once the user accepts, so `signal` is checked after the gate settles.
  const blockedByWriteAccess = async (
    signal: AbortSignal,
  ): Promise<ReturnType<typeof jsonResult> | null> => {
    const blocked = await writeAccessGate();
    if (blocked) {
      return jsonResult(
        { ...blocked, destinationType: config.destinationType },
        true,
      );
    }
    if (signal.aborted) {
      return jsonResult(
        {
          error:
            "The request was cancelled while it waited for consent, so no " +
            "query ran.",
          destinationType: config.destinationType,
        },
        true,
      );
    }
    return null;
  };

  server.registerTool(
    "test_destination",
    {
      title: "Test Telemetry destination",
      description: TEST_DESTINATION_DESCRIPTION,
      // No parameters: the destination is taken entirely from the environment.
      inputSchema: {},
    },
    async () => {
      // 1. Completeness check first — a missing-config finding must never make a
      //    network call. `missingRequiredEnvVars` returns DURABLE_TELEMETRY_* NAMES
      //    (actionable to an MCP user), unlike core's UI labels.
      const missingEnvVars = missingRequiredEnvVars(config);
      if (missingEnvVars.length > 0) {
        const payload = {
          ok: false,
          summary:
            `Destination configuration is incomplete: ${missingEnvVars.length} ` +
            `required environment variable(s) unset. Set them and try again.`,
          checks: [],
          destinationType: config.destinationType,
          region: config.region,
          missingEnvVars,
        };
        // A negative finding about configuration is a SUCCESSFUL tool call, not
        // a tool error — the tool did exactly what it was asked to.
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(payload, null, 2) },
          ],
        };
      }

      // 2. Config is complete — run the real read-only probes.
      try {
        // This server only queries an existing table, so it does not create the
        // Athena table and does not need its source S3 location.
        const report = await testDestination(config, {
          createsAthenaTable: false,
        });
        const payload = {
          ok: report.ok,
          summary: report.summary,
          checks: report.checks,
          destinationType: config.destinationType,
          region: config.region,
          // Nothing was missing on this path; report it explicitly so the
          // result shape is stable regardless of branch.
          missingEnvVars: [] as string[],
        };
        // NOTE: report.ok === false here is a reachable-destination negative
        // finding, NOT a tool error. isError is reserved for genuine failures
        // (thrown exceptions) below.
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(payload, null, 2) },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const payload = {
          ok: false,
          summary: `test_destination failed unexpectedly: ${message}`,
          error: message,
          checks: [],
          destinationType: config.destinationType,
          region: config.region,
          missingEnvVars: [] as string[],
        };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(payload, null, 2) },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "query",
    {
      title: "Run a read-only query",
      description: QUERY_DESCRIPTION,
      inputSchema: {
        sql: z
          .string()
          .describe(
            "A single read-only SQL/PartiQL SELECT (or WITH ... SELECT) " +
              "statement. Data-modifying and DDL statements are rejected.",
          ),
        // Validated at the protocol boundary to be within the hard cap, then
        // passed to runReadOnlyQuery, which clamps it into [1, MAX_ROWS]. It can
        // therefore lower the bound but never raise it.
        limit: z
          .number()
          .int()
          .positive()
          .max(MAX_ROWS)
          .optional()
          .describe(
            `Maximum rows to return (<= ${MAX_ROWS}). Lowering this is worth doing ` +
              `whenever you only need a few rows: every row costs tokens to read. ` +
              `Results are capped at ${MAX_ROWS} whether or not this is set.`,
          ),
        // Time window for CloudWatch Logs Insights destinations ONLY
        // (cloudwatch-logs-exporter / lambda-log-exporter). Logs Insights has no
        // "all time" — it requires an explicit [start, end] window — so this
        // controls how far back the query looks: [now - lookbackHours, now].
        // Ignored by the five SQL destinations, which are not time-windowed.
        // Defaults to 24 hours when omitted. Fractional values are allowed
        // (e.g. 0.5 = last 30 minutes) so an agent investigating a narrow
        // incident window ("last night") can control it.
        lookbackHours: z
          .number()
          .positive()
          .optional()
          .describe(
            "For CloudWatch Logs destinations only: how many hours back to " +
              "search, measured from now (default 24). Logs Insights requires " +
              "an explicit time window. Ignored for SQL destinations.",
          ),
      },
    },
    async ({ sql, limit, lookbackHours }, extra) => {
      // 1. Completeness check first — a missing-config finding must never make a
      //    network call (mirrors test_destination). Returns actionable
      //    DURABLE_TELEMETRY_* variable NAMES.
      const missingEnvVars = missingRequiredEnvVars(config);
      if (missingEnvVars.length > 0) {
        const payload = {
          ok: false,
          summary:
            `Destination configuration is incomplete: ${missingEnvVars.length} ` +
            `required environment variable(s) unset. Set them and try again.`,
          destinationType: config.destinationType,
          missingEnvVars,
        };
        // A missing-config finding is a SUCCESSFUL tool call, not an error.
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(payload, null, 2) },
          ],
        };
      }

      // 2. Stop until the user confirms the read-only responsibility.
      const blocked = await blockedByWriteAccess(extra.signal);
      if (blocked) return blocked;

      // 3. Execute through the single choke point. This is the ONLY place the
      //    tool does anything — it never touches a runner directly.
      try {
        // Translate the log-only lookback window (hours) into the choke point's
        // millisecond option. Undefined for SQL destinations (and when the
        // agent omits it), letting runReadOnlyQuery apply its 24h default.
        const timeRangeMs =
          lookbackHours !== undefined
            ? lookbackHours * 60 * 60 * 1000
            : undefined;
        const result = await runReadOnlyQuery(config, sql, {
          timeRangeMs,
          maxRows: limit,
        });
        const linked = await withViewerLinks(result, viewer);
        const payload = {
          columns: linked.columns,
          rows: linked.rows,
          count: result.count,
          truncated: result.truncated,
          engine: result.engine,
          destinationType: config.destinationType,
        };
        // A query that runs and returns zero rows is a SUCCESS with an empty
        // result — not an error.
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(payload, null, 2) },
          ],
        };
      } catch (err) {
        // A rejected (non-read-only) or failed query is a legitimate tool ERROR:
        // the agent should see that it failed and why. assertReadOnly's message
        // is already specific and actionable, so surface it verbatim.
        const message = err instanceof Error ? err.message : String(err);
        const payload = {
          error: message,
          destinationType: config.destinationType,
        };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(payload, null, 2) },
          ],
          isError: true,
        };
      }
    },
  );

  // describe_schema — pure guidance, no AWS call. Returns the destination's
  // record schema + dialect guidance (from core's buildSystemPrompt) in the
  // RESULT, never the description. No missing-config gate: it makes no network
  // call, so it can help the agent even before a destination is fully set up.
  server.registerTool(
    "describe_schema",
    {
      title: "Describe the Telemetry destination schema",
      description: DESCRIBE_SCHEMA_DESCRIPTION,
      inputSchema: {},
    },
    async () => {
      try {
        return jsonResult(buildDescribeSchemaResult(config));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult(
          { error: message, destinationType: config.destinationType },
          true,
        );
      }
    },
  );

  // get_execution — single-record lookup by execution ARN. One required
  // parameter; optional Athena partition components for pruning. A missing
  // record is a success with found=false.
  server.registerTool(
    "get_execution",
    {
      title: "Get a single execution record",
      description: GET_EXECUTION_DESCRIPTION,
      inputSchema: {
        executionArn: z
          .string()
          .describe(
            "The execution ARN to fetch (DynamoDB partition key / Athena " +
              "executionarn column).",
          ),
        year: z
          .string()
          .optional()
          .describe(
            "Optional Athena/S3 partition year (digits) for partition pruning.",
          ),
        month: z
          .string()
          .optional()
          .describe(
            "Optional Athena/S3 partition month (digits) for partition pruning.",
          ),
        day: z
          .string()
          .optional()
          .describe(
            "Optional Athena/S3 partition day (digits) for partition pruning. " +
              "Ignored on other destinations, which report it back in " +
              "`ignoredParams`.",
          ),
        lookbackHours: z
          .number()
          .positive()
          .optional()
          .describe(
            `For CloudWatch Logs destinations only: how many hours back to ` +
              `search (default ${DEFAULT_RECORD_LOOKBACK_HOURS}). Logs Insights ` +
              `requires an explicit window, so an execution older than this ` +
              `reports found=false; widen it before concluding the execution ` +
              `does not exist. The window searched is returned as ` +
              `searchedLookbackHours.`,
          ),
      },
    },
    async ({ executionArn, year, month, day, lookbackHours }, extra) => {
      const gate = missingConfigResult(config);
      if (gate) return gate;
      const blocked = await blockedByWriteAccess(extra.signal);
      if (blocked) return blocked;
      try {
        const found = await runGetExecution(config, {
          executionArn,
          year,
          month,
          day,
          lookbackHours,
        });
        // Link only an execution the destination actually holds. Linking the
        // agent's argument would let anything that steers the agent make an
        // arbitrary ARN servable by the viewer.
        const url = found.found
          ? await viewer?.linkFor(
              executionArnFromRecord(found.record) ?? found.executionArn,
            )
          : undefined;
        return jsonResult(
          url
            ? {
                ...found,
                [VIEWER_LINK_FIELD]: markdownLink(
                  executionNameFromRecord(found.record),
                  url,
                ),
              }
            : found,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult(
          { error: message, destinationType: config.destinationType },
          true,
        );
      }
    },
  );

  // list_executions — the common "show me executions" case with no SQL from the
  // agent. Every filter is validated/escaped in tools.ts before the SELECT is
  // built, then executed through the same read-only choke point as `query`.
  server.registerTool(
    "list_executions",
    {
      title: "List execution records",
      description: LIST_EXECUTIONS_DESCRIPTION,
      inputSchema: {
        status: z
          .string()
          .optional()
          .describe("Filter by status: RUNNING, SUCCEEDED, or FAILED."),
        functionName: z
          .string()
          .optional()
          .describe("Filter by Lambda function name (exact match)."),
        since: z
          .string()
          .optional()
          .describe(
            "Only executions with startTime >= this ISO-8601 date/date-time.",
          ),
        until: z
          .string()
          .optional()
          .describe(
            "Only executions with startTime <= this ISO-8601 date/date-time.",
          ),
        limit: z
          .number()
          .int()
          .positive()
          .max(MAX_ROWS)
          .optional()
          .describe(
            `Maximum rows to return (<= ${MAX_ROWS}). Defaults to a bounded ` +
              `page; the ${MAX_ROWS} cap always applies.`,
          ),
        lookbackHours: z
          .number()
          .positive()
          .optional()
          .describe(
            "For CloudWatch Logs destinations only: how many hours back to scan. " +
              "Usually unnecessary — when `since` is given the scanned window is " +
              "derived from it. Set this to widen a search that has no `since`. " +
              "The window scanned is returned as searchedLookbackHours; if it is " +
              "narrower than you expected, results may be partial.",
          ),
      },
    },
    async (
      { status, functionName, since, until, limit, lookbackHours },
      extra,
    ) => {
      const gate = missingConfigResult(config);
      if (gate) return gate;
      const blocked = await blockedByWriteAccess(extra.signal);
      if (blocked) return blocked;
      try {
        return jsonResult(
          await withViewerLinks(
            await runListExecutions(config, {
              status,
              functionName,
              since,
              until,
              limit,
              lookbackHours,
            }),
            viewer,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult(
          { error: message, destinationType: config.destinationType },
          true,
        );
      }
    },
  );
}
