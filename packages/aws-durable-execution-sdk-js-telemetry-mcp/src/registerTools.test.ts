/**
 * Calls the registered tools through a real MCP client, connected in memory,
 * with this package's query paths replaced by spies.
 *
 * The property under test: until the user confirms, no data tool reaches its
 * query path. Deleting any tool's `if (blocked) return blocked;` fails a test
 * here.
 */
const testDestination = jest.fn();
jest.mock("@aws/durable-execution-sdk-js-telemetry-core", () => ({
  ...jest.requireActual("@aws/durable-execution-sdk-js-telemetry-core"),
  testDestination: (...args: unknown[]) => testDestination(...args),
}));
const runReadOnlyQuery = jest.fn();
jest.mock("./readOnlyQuery", () => ({
  ...jest.requireActual("./readOnlyQuery"),
  runReadOnlyQuery: (...args: unknown[]) => runReadOnlyQuery(...args),
}));
const runGetExecution = jest.fn();
const runListExecutions = jest.fn();
jest.mock("./tools", () => ({
  ...jest.requireActual("./tools"),
  runGetExecution: (...args: unknown[]) => runGetExecution(...args),
  runListExecutions: (...args: unknown[]) => runListExecutions(...args),
}));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readConfigFromEnv } from "./config";
import { registerTools } from "./registerTools";

const CONFIG = readConfigFromEnv({
  DURABLE_TELEMETRY_DESTINATION_TYPE: "aurora",
  DURABLE_TELEMETRY_AURORA_RESOURCE_ARN: "arn:aws:rds:us-east-1:1:cluster:c",
  DURABLE_TELEMETRY_AURORA_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:1:secret:s",
  DURABLE_TELEMETRY_REGION: "us-east-1",
}).config;

/** The data tools, each with arguments and the spy for its query path. */
const DATA_TOOLS = [
  ["query", { sql: "SELECT 1" }, runReadOnlyQuery],
  ["get_execution", { executionArn: "arn:x" }, runGetExecution],
  ["list_executions", {}, runListExecutions],
] as const;

async function connect(acceptedByEnv: boolean): Promise<Client> {
  const server = new McpServer({ name: "s", version: "0" });
  registerTools(server, CONFIG, acceptedByEnv);
  // No elicitation capability, so the gate cannot ask and must block.
  const client = new Client({ name: "c", version: "0" }, { capabilities: {} });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

function payloadOf(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

beforeEach(() => {
  jest.resetAllMocks();
  runReadOnlyQuery.mockResolvedValue({
    columns: [],
    rows: [],
    count: 0,
    truncated: false,
    engine: "PostgreSQL",
  });
  runGetExecution.mockResolvedValue({ found: false });
  runListExecutions.mockResolvedValue({ executions: [] });
});

describe.each(DATA_TOOLS)("%s", (tool, args, queryPath) => {
  it("does not reach its query path until the user confirms", async () => {
    const client = await connect(false);
    const result = await client.callTool({ name: tool, arguments: args });
    expect(result.isError).toBe(true);
    expect(payloadOf(result).error).toContain(
      "It is your responsibility to give this server read-only credentials.",
    );
    expect(queryPath).not.toHaveBeenCalled();
    await client.close();
  });

  it("reaches its query path when the environment confirms", async () => {
    const client = await connect(true);
    await client.callTool({ name: tool, arguments: args });
    expect(queryPath).toHaveBeenCalledTimes(1);
    await client.close();
  });
});

describe("test_destination", () => {
  it("is not blocked by the gate", async () => {
    testDestination.mockResolvedValue({ ok: true, summary: "s", checks: [] });
    const client = await connect(false);
    const result = await client.callTool({
      name: "test_destination",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    expect(testDestination).toHaveBeenCalledTimes(1);
    await client.close();
  });
});

describe.each(DATA_TOOLS)("%s and cancellation", (tool, args, queryPath) => {
  it("does not query for a call cancelled while it waited for consent", async () => {
    const server = new McpServer({ name: "s", version: "0" });
    registerTools(server, CONFIG, false);
    // A client that supports the prompt, and answers it only when told to.
    const client = new Client(
      { name: "c", version: "0" },
      { capabilities: { elicitation: {} } },
    );
    let answer: (() => void) | undefined;
    const prompted = new Promise<void>((resolve) => {
      client.setRequestHandler(ElicitRequestSchema, () => {
        resolve();
        return new Promise((reply) => {
          answer = () =>
            reply({ action: "accept", content: { acceptRisk: true } });
        });
      });
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);

    // Two calls share one prompt. The first is cancelled before the answer.
    const abort = new AbortController();
    const cancelled = client
      .callTool({ name: tool, arguments: args }, undefined, {
        signal: abort.signal,
      })
      .catch(() => "cancelled");
    const kept = client.callTool({ name: tool, arguments: args });
    await prompted;
    abort.abort();
    expect(await cancelled).toBe("cancelled");
    answer?.();
    const result = await kept;

    expect(result.isError).toBeFalsy();
    expect(queryPath).toHaveBeenCalledTimes(1);
    await client.close();
  });
});
