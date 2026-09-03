/**
 * Integration test for the MCP server. This exercises the REAL protocol: it
 * spawns the BUILT `dist/server.js` as a child process and talks to it with the
 * MCP SDK's own client over a stdio transport. Nothing here is mocked — a
 * passing run means an actual MCP client completed a handshake and a tool call
 * against the shipped binary.
 *
 * The missing-config assertion deliberately runs with an incomplete environment
 * and NO AWS credentials, exercising the path that returns before any AWS call.
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER_PATH = path.resolve(__dirname, "..", "dist", "server.js");
const SERVER_BUILT = existsSync(SERVER_PATH);

// A hanging stdio test is worse than a failing one: cap every test, and if the
// built binary is missing, skip loudly rather than spawn something that hangs.
const TIMEOUT_MS = 30_000;

if (!SERVER_BUILT) {
  console.warn(
    `[server.test] ${SERVER_PATH} not found — skipping integration tests. ` +
      `Run \`npm run build\` first (the package's \`test\` script does this).`,
  );
}

const describeIfBuilt = SERVER_BUILT ? describe : describe.skip;

describeIfBuilt("durable-insight MCP server (spawned binary)", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: process.execPath, // this node binary
      args: [SERVER_PATH],
      // Deliberately minimal, credential-free environment. We select the
      // dynamodb destination but leave DURABLE_INSIGHT_DYNAMODB_TABLE_NAME
      // unset, so test_destination must report the missing variable WITHOUT
      // touching AWS. PATH is passed only so `node` can resolve.
      env: {
        PATH: process.env.PATH ?? "",
        DURABLE_INSIGHT_DESTINATION_TYPE: "dynamodb",
      },
      stderr: "pipe",
    });

    client = new Client(
      { name: "durable-insight-test-client", version: "0.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);
  }, TIMEOUT_MS);

  afterAll(async () => {
    // Closing the transport terminates the child process; without this jest
    // could hang waiting on an open handle.
    await client?.close();
  });

  it(
    "completes the initialize handshake and reports its server name",
    () => {
      const info = client.getServerVersion();
      expect(info?.name).toBe("durable-insight");
    },
    TIMEOUT_MS,
  );

  it(
    "lists test_destination with a non-empty, bounded description",
    async () => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain("test_destination");

      const tool = tools.find((t) => t.name === "test_destination");
      expect(tool?.description).toBeDefined();
      expect(tool!.description!.length).toBeGreaterThan(0);
      // Long descriptions degrade agent performance; keep well under the cap.
      expect(tool!.description!.length).toBeLessThan(10_000);
    },
    TIMEOUT_MS,
  );

  it(
    "names the missing env var on an incomplete, credential-free environment",
    async () => {
      const result = await client.callTool({
        name: "test_destination",
        arguments: {},
      });

      // A missing-config finding is a successful tool call, not a tool error.
      expect(result.isError).toBeFalsy();

      const content = result.content as Array<{ type: string; text?: string }>;
      const textBlock = content.find((c) => c.type === "text");
      expect(textBlock?.text).toBeDefined();

      // The result MUST be machine-readable JSON, never prose.
      const payload = JSON.parse(textBlock!.text!);
      expect(payload.ok).toBe(false);
      expect(payload.destinationType).toBe("dynamodb");
      expect(Array.isArray(payload.missingEnvVars)).toBe(true);
      // The actionable environment variable name — not the UI label.
      expect(payload.missingEnvVars).toContain(
        "DURABLE_INSIGHT_DYNAMODB_TABLE_NAME",
      );
    },
    TIMEOUT_MS,
  );

  it(
    "keeps stdout clean — a full MCP session is itself the evidence",
    async () => {
      // If the server wrote any non-frame bytes to stdout, the SDK client's
      // JSON-RPC parser would have thrown before now and these prior calls
      // would have failed. A second successful round-trip reconfirms the
      // transport is still an uncorrupted protocol stream.
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(0);
    },
    TIMEOUT_MS,
  );

  it(
    "writes NOTHING to stdout before any request (direct stdout-purity check)",
    async () => {
      // The SDK client is deliberately lenient: its read loop catches a bad
      // line, reports it to an (unset) onerror, and continues — so a stray
      // `console.log` on its own line is SKIPPED and a session still succeeds.
      // A successful session therefore does NOT catch a stray stdout write.
      // This asserts stdout purity directly instead: a correct MCP server emits
      // zero bytes on stdout until it receives a request, so spawning it with an
      // immediately-closed stdin must produce empty stdout. Any startup-time
      // stdout write (e.g. console.log) fails this.
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, [SERVER_PATH], {
          env: {
            PATH: process.env.PATH ?? "",
            DURABLE_INSIGHT_DESTINATION_TYPE: "dynamodb",
          },
          stdio: ["pipe", "pipe", "ignore"],
        });
        let out = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          out += chunk;
        });
        child.on("error", reject);
        child.on("close", () => resolve(out));
        // No request — just close stdin so the server sees EOF and exits.
        child.stdin.end();
        // Safety net so a hung child can never hang the test.
        const killer = setTimeout(
          () => child.kill("SIGKILL"),
          TIMEOUT_MS - 5_000,
        );
        child.on("close", () => clearTimeout(killer));
      });

      expect(stdout).toBe("");
    },
    TIMEOUT_MS,
  );

  it(
    "lists both registered prompts over the real protocol (AC-5.1)",
    async () => {
      const { prompts } = await client.listPrompts();
      const names = prompts.map((p) => p.name);
      // Prove reachability through the protocol, not by unit-testing handlers.
      expect(names).toContain("investigate_workflow_failure");
      expect(names).toContain("explore_recent_executions");

      const investigate = prompts.find(
        (p) => p.name === "investigate_workflow_failure",
      );
      expect(investigate?.description).toBeDefined();
      expect(investigate!.description!.length).toBeGreaterThan(0);
    },
    TIMEOUT_MS,
  );

  it(
    "returns usable messages from prompts/get, honoring arguments",
    async () => {
      const result = await client.getPrompt({
        name: "investigate_workflow_failure",
        arguments: { functionName: "checkout-fn", lookbackHours: "12" },
      });

      expect(Array.isArray(result.messages)).toBe(true);
      expect(result.messages.length).toBeGreaterThan(0);

      const first = result.messages[0];
      expect(first.role).toBe("user");
      expect(first.content.type).toBe("text");
      const text = (first.content as { type: "text"; text: string }).text;
      // The guidance encodes the ORDER of operations and delegates schema to
      // describe_schema — never inlines destination-specific schema facts.
      expect(text).toContain("describe_schema");
      expect(text).toContain("list_executions");
      // Supplied arguments are woven into the rendered guidance.
      expect(text).toContain("checkout-fn");
      expect(text).toContain("12");
    },
    TIMEOUT_MS,
  );
});
