#!/usr/bin/env node
/**
 * Durable Insight MCP server (stdio transport).
 *
 * This is the `bin` target for the package. It exposes the Insight destination
 * tooling to an MCP client (e.g. an agent) over stdio.
 *
 * STDOUT DISCIPLINE — read before editing:
 *   stdout is the MCP transport. Every byte written to it MUST be a protocol
 *   frame emitted by the SDK. A stray `console.log` (or anything else writing to
 *   process.stdout) injects non-JSON-RPC bytes into the stream and corrupts the
 *   session — the client typically fails to parse and the server appears broken
 *   for no obvious reason. All diagnostics therefore go to STDERR via
 *   {@link logStderr}. Never use `console.log` in this file or anything it calls
 *   on the startup path.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { testDestination, type InsightConfig } from "durable-insight-core";
import { readConfigFromEnv } from "./config";
import { missingRequiredEnvVars } from "./config";

/**
 * The package's own version. esbuild replaces this token at build time with the
 * `version` string read from this package's package.json (see esbuild.mjs), so
 * there is exactly one source of truth and no second copy is hard-coded here.
 * Declared (not imported) so it also type-checks under the package's CommonJS
 * tsconfig, which forbids `import.meta`.
 */
declare const DURABLE_INSIGHT_MCP_VERSION: string;

/** All diagnostics go to stderr — stdout is reserved for the MCP transport. */
function logStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

/**
 * One or two sentences, well under the 10,000-char cap. Bulk detail lives in the
 * tool result (machine-readable JSON), not in this description.
 */
const TEST_DESTINATION_DESCRIPTION =
  "Run read-only connectivity and completeness checks against the configured " +
  "Insight destination (configured via DURABLE_INSIGHT_* environment variables) " +
  "and return a machine-readable JSON report. If required environment variables " +
  "are unset it names them and returns without making any AWS calls.";

/**
 * Registers the single `test_destination` tool. The `config` is captured from
 * startup (read once) so the tool never re-reads the environment.
 */
function registerTools(server: McpServer, config: InsightConfig): void {
  server.registerTool(
    "test_destination",
    {
      title: "Test Insight destination",
      description: TEST_DESTINATION_DESCRIPTION,
      // No parameters: the destination is taken entirely from the environment.
      inputSchema: {},
    },
    async () => {
      // 1. Completeness check first — a missing-config finding must never make a
      //    network call. `missingRequiredEnvVars` returns DURABLE_INSIGHT_* NAMES
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
        const report = await testDestination(config);
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
}

async function main(): Promise<void> {
  // Read config ONCE at startup. Do NOT exit on missing destination config — a
  // server that refuses to start surfaces in a client as an unexplained
  // failure. Emit warnings to stderr; the test_destination tool diagnoses the
  // rest.
  const { config, warnings } = readConfigFromEnv();
  for (const warning of warnings) {
    logStderr(`[durable-insight] warning: ${warning}`);
  }

  const server = new McpServer({
    name: "durable-insight",
    version: DURABLE_INSIGHT_MCP_VERSION,
  });

  registerTools(server, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logStderr("[durable-insight] MCP server ready on stdio.");
}

main().catch((err) => {
  const message =
    err instanceof Error ? (err.stack ?? err.message) : String(err);
  logStderr(`[durable-insight] fatal: ${message}`);
  process.exit(1);
});
