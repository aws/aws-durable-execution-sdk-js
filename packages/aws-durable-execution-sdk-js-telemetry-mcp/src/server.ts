#!/usr/bin/env node
/**
 * Durable Telemetry MCP server (stdio transport).
 *
 * This is the `bin` target for the package. It exposes the Telemetry destination
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
import { readConfigFromEnv } from "./config";
import { registerPrompts } from "./prompts";
import { registerTools } from "./registerTools";
import { writeAccessAcceptedByEnv } from "./writeAccessGate";

/**
 * The package's own version. esbuild replaces this token at build time with the
 * `version` string read from this package's package.json (see esbuild.mjs), so
 * there is exactly one source of truth and no second copy is hard-coded here.
 * Declared (not imported) so it also type-checks under the package's CommonJS
 * tsconfig, which forbids `import.meta`.
 */
declare const DURABLE_TELEMETRY_MCP_VERSION: string;

/** All diagnostics go to stderr — stdout is reserved for the MCP transport. */
function logStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function main(): Promise<void> {
  // Read config ONCE at startup. Do NOT exit on missing destination config — a
  // server that refuses to start surfaces in a client as an unexplained
  // failure. Emit warnings to stderr; the test_destination tool diagnoses the
  // rest.
  const { config, warnings } = readConfigFromEnv();
  for (const warning of warnings) {
    logStderr(`[durable-telemetry] warning: ${warning}`);
  }

  const server = new McpServer({
    name: "durable-telemetry",
    version: DURABLE_TELEMETRY_MCP_VERSION,
  });

  registerTools(server, config, writeAccessAcceptedByEnv(process.env));
  registerPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logStderr("[durable-telemetry] MCP server ready on stdio.");
}

main().catch((err) => {
  const message =
    err instanceof Error ? (err.stack ?? err.message) : String(err);
  logStderr(`[durable-telemetry] fatal: ${message}`);
  process.exit(1);
});
